import logging
import httpx
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional

from src.config import AppConfig, MonitorConfig, RuleConfig
from src.alpaca import AlpacaClient
from src.engine import calculate_lookback_start
from src.indicators import evaluate_indicator_rule
from src.database import StateDatabase
from src.llm import (
    DEFAULT_OLLAMA_CLOUD_MODEL,
    ollama_auth_headers,
    ollama_base_url,
    ollama_is_local,
    ollama_model,
)

logger = logging.getLogger(__name__)


class OwlSpeaksAgent:
    """Owl Speaks chat agent.

    `config` may be None, which is what serverless mode and a misconfigured deployment
    look like: without it there are no monitors to pull indicator context from and no
    Alpaca credentials to fetch quotes with, so the agent answers from the model alone
    rather than failing the request. The same applies piecewise — absent credentials or
    an unwritable database each disable their own feature, nothing more.
    """

    def __init__(self, config: Optional[AppConfig] = None, db_path: str = "data/alerts.db"):
        self.config = config
        self.db_path = db_path
        self.client = None
        self.db = None

        alpaca = getattr(config, "alpaca", None)
        if alpaca and alpaca.api_key and alpaca.api_secret:
            self.client = AlpacaClient(
                api_key=alpaca.api_key,
                api_secret=alpaca.api_secret,
                data_base_url=alpaca.data_base_url
            )
        else:
            logger.warning(
                "Owl Speaks has no Alpaca credentials; answering without live market context."
            )

        try:
            self.db = StateDatabase(db_path=db_path)
        except Exception as e:
            # A read-only filesystem is the normal case on Vercel. Alert history is
            # context, not a requirement, so drop it and carry on.
            logger.warning("Owl Speaks alert history unavailable (%s).", e)

    @property
    def monitors(self) -> List[MonitorConfig]:
        return list(getattr(self.config, "monitors", []) or [])

    def get_symbol_context(self, symbol: str) -> str:
        """
        Gathers live data, computes technical indicators, and checks SQLite database 
        alerts history for a given symbol to provide rich context to the LLM.
        """
        symbol_upper = symbol.strip().upper()
        # Find the monitor configuration for this symbol
        monitor: Optional[MonitorConfig] = None
        for m in self.monitors:
            if m.symbol.upper() == symbol_upper:
                monitor = m
                break

        if not monitor:
            return f"Note: Symbol '{symbol_upper}' is not currently monitored by the alert system. No pre-calculated indicator context is available."

        if not self.client:
            return (
                f"Note: Symbol '{symbol_upper}' is monitored, but this deployment has no Alpaca "
                "credentials configured, so no live indicator values could be calculated."
            )

        context_lines = []
        context_lines.append(f"### Technical Context for {symbol_upper} (Asset Class: {monitor.asset_class})")

        # Group rules by timeframe to batch Alpaca bar requests
        timeframe_rules: Dict[str, List[RuleConfig]] = {}
        for rule in monitor.rules:
            if rule.timeframe not in timeframe_rules:
                timeframe_rules[rule.timeframe] = []
            timeframe_rules[rule.timeframe].append(rule)

        current_price = None

        # Fetch and calculate indicators for each timeframe
        for timeframe, rules in timeframe_rules.items():
            # Find the maximum indicator period in this group
            max_period = 14
            for r in rules:
                periods = [
                    r.params.get("period"),
                    r.params.get("slow_period"),
                    r.params.get("fast_period")
                ]
                for p in periods:
                    if p is not None and int(p) > max_period:
                        max_period = int(p)

            start_time = calculate_lookback_start(timeframe, max_period)

            try:
                # Fetch historical bars
                bars_dict = self.client.get_historical_bars(
                    symbols=[symbol_upper],
                    asset_class=monitor.asset_class,
                    timeframe=timeframe,
                    start_time=start_time
                )
                df = bars_dict.get(symbol_upper)
                
                if df is not None and not df.empty:
                    if current_price is None:
                        current_price = float(df["close"].iloc[-1])
                        context_lines.append(f"- Current Price: ${current_price:.2f}")

                    context_lines.append(f"- **Timeframe: {timeframe}**")
                    for rule in rules:
                        triggered, actual_value, metadata = evaluate_indicator_rule(
                            df=df,
                            indicator=rule.indicator,
                            params=rule.params,
                            operator=rule.condition.operator,
                            value=rule.condition.value
                        )
                        # Format the output beautifully
                        trigger_status = "TRIGGERED" if triggered else "Neutral"
                        metadata_str = ", ".join([f"{k}={v:.2f}" if isinstance(v, (int, float)) else f"{k}={v}" for k, v in metadata.items() if v is not None])
                        context_lines.append(
                            f"  * Rule: {rule.name} | Status: {trigger_status} | Latest Val: {actual_value:.2f} ({metadata_str})"
                        )
                else:
                    context_lines.append(f"- **Timeframe: {timeframe}**: No market data returned from Alpaca.")
            except Exception as e:
                logger.error(f"Error gathering indicators context for {symbol_upper} ({timeframe}): {e}")
                context_lines.append(f"- **Timeframe: {timeframe}**: Failed to load data/calculate indicators ({str(e)}).")

        # Fetch recent alert history for this symbol
        if not self.db:
            return "\n".join(context_lines)
        try:
            all_alerts = self.db.get_all_alerts(limit=50)
            symbol_alerts = [a for a in all_alerts if a["symbol"].upper() == symbol_upper][:5]
            if symbol_alerts:
                context_lines.append("- **Recent Alert History (Last 5 Triggers)**:")
                for alert in symbol_alerts:
                    # convert timestamp if needed
                    triggered_time = datetime.fromtimestamp(alert["triggered_at"], timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
                    context_lines.append(
                        f"  * {triggered_time} - Rule '{alert['rule_id']}' triggered at bar {alert['bar_time']} with value {alert['value']:.2f}"
                    )
            else:
                context_lines.append("- **Recent Alert History**: No alerts have triggered recently for this symbol.")
        except Exception as e:
            logger.error(f"Error loading alerts history for {symbol_upper}: {e}")

        return "\n".join(context_lines)

    async def generate_response(self, user_message: str, symbol: Optional[str] = None, history: Optional[List[Dict[str, str]]] = None, images: Optional[List[str]] = None) -> str:
        """
        Sends the user message and conversation history to the local Ollama instance, 
        injecting the technical indicator context if a symbol is specified.
        """
        # Load configuration environment settings
        base_url = ollama_base_url()
        model_name = ollama_model()
        url = f"{base_url}/api/chat"

        # 1. Gather context if symbol is provided
        context_str = ""
        if symbol:
            context_str = self.get_symbol_context(symbol)

        # 2. Extract potential symbols from the user message for real-time RAG news/quote injection
        rag_symbols = []
        msg_upper = user_message.upper()

        # Cross-reference with config monitors first
        for monitor in self.monitors:
            sym = monitor.symbol.upper()
            if sym in msg_upper or sym.replace("/", "") in msg_upper:
                rag_symbols.append((monitor.symbol, monitor.asset_class))
        
        # Fall back to general regex parser for potential stock/crypto tickers not in monitors
        # Run on the original user_message (case-sensitive) to only match uppercase tickers
        # and enforce a length of 2 to 5 letters to avoid matching single characters like "I" or "A"
        import re
        potential_tickers = re.findall(r'\b([A-Z]{2,5})(?:/USD|USD)?\b', user_message)
        
        # Standard list of keywords, verbs, indicators, and abbreviations to exclude
        exclude_words = {
            "RSI", "MACD", "EMA", "SMA", "LLM", "AI", "OIDC", "SSO", "USD", "BTC", "ETH", "USDT",
            "BUY", "SELL", "CALL", "PUT", "NEWS", "RAG", "CHAT", "HELP", "INFO", "LONG", "HOLD",
            "PORT", "HTML", "JSON", "API", "HTTP", "REST", "OAUT", "VWAP", "VMAP", "AVWAP", "ATR",
            "ADX", "OBV", "ROC", "SEC", "FED", "FOMC", "CPI", "GDP", "ETF", "USA", "STOCK", "SHARE",
            "PRICE", "BANDS", "CHART"
        }
        
        for ticker in potential_tickers:
            if (ticker not in [s[0] for s in rag_symbols] and ticker not in exclude_words):
                asset_class = "crypto" if ticker in ["BTC", "ETH", "SOL", "ADA", "XRP", "DOGE"] else "stock"
                symbol_query = f"{ticker}/USD" if asset_class == "crypto" else ticker
                rag_symbols.append((symbol_query, asset_class))

        # Fetch real-time snapshots and news context for up to 3 symbols to avoid token overflow
        rag_context_blocks = []
        for rag_sym, rag_asset in (rag_symbols[:3] if self.client else []):
            snapshot = self.client.get_snapshot(rag_sym, rag_asset)
            news = self.client.get_news(rag_sym, limit=3)
            
            if not snapshot and not news:
                continue
            
            block = []
            block.append(f"### Real-time Market Quote: {rag_sym}")
            if snapshot:
                latest_trade = snapshot.get("latestTrade") or snapshot.get("trade")
                latest_quote = snapshot.get("latestQuote") or snapshot.get("quote")
                daily_bar = snapshot.get("dailyBar")
                
                if latest_trade:
                    price = latest_trade.get('p') or latest_trade.get('price')
                    if price is not None:
                        try:
                            block.append(f"- **Current Price**: ${float(price):.2f}")
                        except ValueError:
                            block.append(f"- **Current Price**: {price}")
                    size = latest_trade.get('s') or latest_trade.get('size')
                    if size is not None:
                        block.append(f"- **Last Trade Size**: {size}")
                if latest_quote:
                    ask = latest_quote.get('ap') or latest_quote.get('askPrice') or latest_quote.get('askprice')
                    bid = latest_quote.get('bp') or latest_quote.get('bidPrice') or latest_quote.get('bidprice')
                    if ask is not None and bid is not None:
                        try:
                            block.append(f"- **Bid/Ask Spread**: ${float(bid):.2f} / ${float(ask):.2f}")
                        except ValueError:
                            block.append(f"- **Bid/Ask Spread**: {bid} / {ask}")
                if daily_bar:
                    high = daily_bar.get('h') or daily_bar.get('high')
                    low = daily_bar.get('l') or daily_bar.get('low')
                    vol = daily_bar.get('v') or daily_bar.get('volume')
                    if high is not None and low is not None:
                        try:
                            block.append(f"- **Daily Range**: Low ${float(low):.2f} - High ${float(high):.2f}")
                        except ValueError:
                            block.append(f"- **Daily Range**: Low {low} - High {high}")
                    if vol is not None:
                        block.append(f"- **Daily Volume**: {vol:,}" if isinstance(vol, (int, float)) else f"- **Daily Volume**: {vol}")
            else:
                block.append("- No real-time snapshot quote available.")
                
            if news:
                block.append(f"\n- **Recent Financial News for {rag_sym}**:")
                for article in news:
                    headline = article.get("headline") or article.get("title") or ""
                    summary = article.get("summary") or ""
                    source = article.get("source") or "Alpaca"
                    updated = article.get("updated_at") or article.get("created_at") or ""
                    if updated:
                        updated = updated.split("T")[0]
                    block.append(f"  * **{headline}** ({source} | {updated})")
                    if summary:
                        short_summary = summary[:150] + "..." if len(summary) > 150 else summary
                        block.append(f"    *Summary:* {short_summary}")
            
            rag_context_blocks.append("\n".join(block))
            
        rag_context_str = "\n\n".join(rag_context_blocks)

        # 3. Construct System Prompt
        system_prompt = (
            "You are Owl Speaks, a premium financial analyst, quantitative researcher, and algorithmic trading assistant.\n"
            "You provide objective, data-driven financial insights, technical analysis, and market interpretations.\n\n"
            "CRITICAL INSTRUCTIONS:\n"
            "1. Tone: Maintain a professional, clear, analytical, and objective tone. Do not make exaggerated claims.\n"
        )

        if context_str:
            system_prompt += (
                "2. Trading Setup: Start your response with a concise, bolded summary of the asset's current technical setup based on the data provided below. Focus on indicators like RSI, EMA/SMA crossovers, MACD, and Bollinger Bands.\n"
                "3. Advice/Analysis: Integrate the calculated indicator metrics and any recent alert logs directly into your logical deduction.\n"
            )

        system_prompt += (
            "4. Disclaimer: ALWAYS append a brief standard financial disclaimer at the end of your response, separated by a horizontal line (---). State clearly that your analysis is for educational purposes only and does not constitute official financial or investment advice.\n"
        )

        if context_str:
            system_prompt += f"\nHere is the real-time technical indicator context for the target asset:\n```markdown\n{context_str}\n```\n"
        if rag_context_str:
            system_prompt += f"\nHere is the real-time market quote and financial news context retrieved for assets discussed in this query:\n```markdown\n{rag_context_str}\n```\n"

        # 3. Format message history for Ollama API
        messages = [{"role": "system", "content": system_prompt}]

        if history:
            # Add past history, ensuring roles are 'user' or 'assistant'
            for msg in history:
                if msg.get("role") in ["user", "assistant"]:
                    messages.append({"role": msg["role"], "content": msg["content"]})

        # Add the current user question
        user_msg = {"role": "user", "content": user_message}
        if images:
            user_msg["images"] = images
        messages.append(user_msg)
 
        payload = {
            "model": model_name,
            "messages": messages,
            "stream": False
        }

        # 4. Query the Ollama API — a local instance, Ollama Cloud, or any compatible
        # endpoint. All three speak this same route; the bearer header is only present when
        # a key is configured.
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(url, json=payload, headers=ollama_auth_headers())
                response.raise_for_status()
                response_json = response.json()

                # Check format of Ollama response
                if "message" in response_json and "content" in response_json["message"]:
                    return response_json["message"]["content"]
                elif "response" in response_json:
                    return response_json["response"]
                else:
                    return "Error: Unexpected response format from Ollama."
        except httpx.HTTPStatusError as e:
            logger.error(f"Ollama API error ({e.response.status_code}): {e.response.text}", exc_info=True)
            try:
                err_json = e.response.json()
                detail = err_json.get("error", {}).get("message") or err_json.get("error") or e.response.text
            except Exception:
                detail = e.response.text

            # A rejected key and a missing one look the same from the response body, so say
            # which case this is rather than passing the bare status through.
            if e.response.status_code in (401, 403):
                if ollama_auth_headers():
                    return (
                        f"⚠️ **Ollama Authentication Error ({e.response.status_code})**\n\n"
                        f"The endpoint at `{base_url}` rejected the configured API key: {detail}\n\n"
                        "Check that `OLLAMA_API_KEY` is current — keys can be revoked at "
                        "https://ollama.com/settings/keys."
                    )
                return (
                    f"⚠️ **Ollama Authentication Error ({e.response.status_code})**\n\n"
                    f"The endpoint at `{base_url}` requires authentication and no API key is "
                    "configured. Set `OLLAMA_API_KEY` in this deployment's environment."
                )

            # Much of the Ollama Cloud catalogue rejects a request carrying `images` with a
            # bare 400, which is indistinguishable from a malformed payload unless the
            # attachment is called out.
            if e.response.status_code == 400 and images:
                return (
                    f"⚠️ **Ollama API Error (400)**\n\n"
                    f"`{model_name}` rejected this request, which included "
                    f"{len(images)} image(s): {detail}\n\n"
                    "Most models cannot read images. Either send the question without an "
                    "attachment, or set `OLLAMA_MODEL` to a vision-capable model — "
                    f"`{DEFAULT_OLLAMA_CLOUD_MODEL}` and `minimax-m3` both accept them."
                )

            if e.response.status_code == 404:
                return (
                    f"⚠️ **Ollama Model Error ({e.response.status_code})**\n\n"
                    f"The endpoint at `{base_url}` does not have the model `{model_name}`: {detail}\n\n"
                    "Set `OLLAMA_MODEL` to a model it serves. Note that Ollama Cloud's "
                    "catalogue differs from a local install's — see https://ollama.com/search."
                )

            return f"⚠️ **Ollama API Error ({e.response.status_code})**: {detail}"
        except httpx.ConnectError:
            logger.error("Failed to connect to the Ollama instance at %s", base_url)
            if ollama_is_local(base_url):
                return (
                    "⚠️ **Ollama Connection Error**\n\n"
                    f"Could not connect to the local Ollama instance at `{base_url}`.\n\n"
                    "Please make sure:\n"
                    "1. Ollama is installed and running on your system.\n"
                    f"2. The model `{model_name}` has been downloaded (run `ollama pull {model_name}` in your terminal).\n"
                    "3. If you are running under a custom port, make sure `OLLAMA_BASE_URL` is set correctly in your environment."
                )
            return (
                "⚠️ **Ollama Connection Error**\n\n"
                f"Could not reach the Ollama endpoint at `{base_url}`.\n\n"
                "Please make sure:\n"
                "1. The endpoint is running and reachable from the internet.\n"
                f"2. It serves the model `{model_name}`.\n"
                "3. `OLLAMA_BASE_URL` is set to its public address in this deployment's "
                "environment — or unset it and set `OLLAMA_API_KEY` to use Ollama Cloud."
            )
        except Exception as e:
            logger.error(f"Error querying Ollama API: {e}", exc_info=True)
            return f"⚠️ **Error generating response**: {str(e)}"
