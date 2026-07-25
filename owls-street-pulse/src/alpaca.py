import time
import logging
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Any
import pandas as pd
import requests
from requests.exceptions import RequestException

logger = logging.getLogger(__name__)

class AlpacaClient:
    def __init__(self, api_key: str, api_secret: str, data_base_url: str = "https://data.alpaca.markets"):
        self.api_key = api_key
        self.api_secret = api_secret
        self.data_base_url = data_base_url
        self.headers = {
            "APCA-API-KEY-ID": self.api_key,
            "APCA-API-SECRET-KEY": self.api_secret,
            "Accept": "application/json"
        }

    def _request_with_retry(self, url: str, params: Dict[str, Any], max_retries: int = 5) -> Dict[str, Any]:
        """Makes an HTTP request with exponential backoff for rate limits and server errors."""
        attempt = 0
        while attempt < max_retries:
            try:
                response = requests.get(url, headers=self.headers, params=params, timeout=15)
                
                # If rate-limited, wait and retry
                if response.status_code == 429:
                    attempt += 1
                    sleep_time = 2 ** attempt
                    logger.warning(f"Rate limited by Alpaca. Retrying in {sleep_time} seconds (attempt {attempt}/{max_retries})...")
                    time.sleep(sleep_time)
                    continue

                # If server error, retry
                if response.status_code >= 500:
                    attempt += 1
                    sleep_time = 2 ** attempt
                    logger.warning(f"Alpaca server error {response.status_code}. Retrying in {sleep_time} seconds (attempt {attempt}/{max_retries})...")
                    time.sleep(sleep_time)
                    continue

                # Raise for other bad status codes
                response.raise_for_status()
                return response.json()

            except RequestException as e:
                attempt += 1
                if attempt >= max_retries:
                    logger.error(f"Failed to fetch data from Alpaca after {max_retries} attempts.")
                    raise e
                sleep_time = 2 ** attempt
                logger.warning(f"Connection error: {e}. Retrying in {sleep_time} seconds...")
                time.sleep(sleep_time)

        raise RequestException("Max retries exceeded without getting a response")

    def get_historical_bars(
        self,
        symbols: List[str],
        asset_class: str,
        timeframe: str,
        start_time: datetime,
        end_time: Optional[datetime] = None,
        limit: int = 1000
    ) -> Dict[str, pd.DataFrame]:
        """
        Fetches historical bars for multiple symbols and returns a dictionary of sorted DataFrames.
        
        Args:
            symbols: List of ticker symbols (e.g. ['AAPL', 'MSFT'] or ['BTC/USD'])
            asset_class: "stock" or "crypto"
            timeframe: Alpaca timeframe string (e.g., '1Min', '15Min', '1Hour', '1Day')
            start_time: Start of historical period
            end_time: End of historical period. If stock, automatically adjusted to be at least 15 min ago.
            limit: Limit of bars per API request
            
        Returns:
            Dict[str, pd.DataFrame]: Map of symbol -> DataFrame of bars (ohlcv)
        """
        if not symbols:
            return {}

        # Set endpoints
        if asset_class.lower() == "stock":
            url = f"{self.data_base_url}/v2/stocks/bars"
            # Free tier Stock data is delayed by 15 minutes
            fifteen_mins_ago = datetime.now(timezone.utc) - timedelta(minutes=15)
            if end_time is None or end_time > fifteen_mins_ago:
                end_time = fifteen_mins_ago
        elif asset_class.lower() == "crypto":
            url = f"{self.data_base_url}/v1beta3/crypto/us/bars"
            if end_time is None:
                end_time = datetime.now(timezone.utc)
        else:
            raise ValueError(f"Unsupported asset class: {asset_class}")

        # Standardize start/end to RFC3339 strings
        start_str = start_time.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
        end_str = end_time.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")

        params = {
            "symbols": ",".join(symbols),
            "timeframe": timeframe,
            "start": start_str,
            "end": end_str,
            "limit": limit
        }

        # For stocks on the free tier, we must specify feed=iex
        if asset_class.lower() == "stock":
            params["feed"] = "iex"

        raw_bars = {sym: [] for sym in symbols}
        next_page_token = None

        while True:
            current_params = params.copy()
            if next_page_token:
                current_params["page_token"] = next_page_token

            logger.debug(f"Fetching {timeframe} bars for {symbols} from {start_str} to {end_str}")
            data = self._request_with_retry(url, current_params)
            
            bars_data = data.get("bars", {})
            for sym in symbols:
                if sym in bars_data:
                    raw_bars[sym].extend(bars_data[sym])

            next_page_token = data.get("next_page_token")
            if not next_page_token:
                break

        # Convert raw JSON bar lists into sorted pandas DataFrames
        result = {}
        for sym, bar_list in raw_bars.items():
            if not bar_list:
                logger.warning(f"No bars returned for {sym} in timeframe {timeframe}")
                result[sym] = pd.DataFrame(columns=["open", "high", "low", "close", "volume"])
                continue

            df = pd.DataFrame(bar_list)
            # Map Alpaca abbreviations to standard column names
            # t: time, o: open, h: high, l: low, c: close, v: volume
            df = df.rename(columns={
                "t": "timestamp",
                "o": "open",
                "h": "high",
                "l": "low",
                "c": "close",
                "v": "volume"
            })
            
            # Format and set timestamp index
            df["timestamp"] = pd.to_datetime(df["timestamp"])
            df = df.sort_values("timestamp").reset_index(drop=True)
            df.set_index("timestamp", inplace=True)
            
            # Ensure correct numeric types
            numeric_cols = ["open", "high", "low", "close", "volume"]
            for col in numeric_cols:
                if col in df.columns:
                    df[col] = pd.to_numeric(df[col])

            result[sym] = df

        return result

    def get_snapshot(self, symbol: str, asset_class: str = "stock") -> Optional[Dict[str, Any]]:
        """Fetches the latest snapshot (latest trade, quote, and daily bar) for a symbol."""
        sym = symbol.strip().upper()
        if asset_class.lower() == "stock":
            url = f"{self.data_base_url}/v2/stocks/{sym}/snapshot"
            params = {"feed": "iex"}
        elif asset_class.lower() == "crypto":
            url = f"{self.data_base_url}/v1beta3/crypto/us/snapshots"
            params = {"symbols": sym}
        else:
            return None

        try:
            data = self._request_with_retry(url, params)
            if asset_class.lower() == "crypto":
                return data.get("snapshots", {}).get(sym)
            return data
        except Exception as e:
            logger.error(f"Error fetching snapshot for {sym}: {e}")
            return None

    def get_news(self, symbol: str, limit: int = 3) -> List[Dict[str, Any]]:
        """Fetches the latest news articles for a symbol."""
        sym = symbol.strip().upper()
        url = f"{self.data_base_url}/v1beta1/news"
        params = {
            "symbols": sym,
            "limit": limit,
            "sort": "desc"
        }
        try:
            data = self._request_with_retry(url, params)
            return data.get("news", [])
        except Exception as e:
            logger.error(f"Error fetching news for {sym}: {e}")
            return []
