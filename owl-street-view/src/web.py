import os
import json
import logging
import asyncio
from typing import Optional, Dict, List, Any
from fastapi import FastAPI, Request, Response, HTTPException, Depends, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError

from src.config import AppConfig
from src.alpaca_service import (
    AlpacaService,
    MarketOrderBody,
    LimitOrderBody,
    AdvancedOrderBody,
    ReplaceOrderBody,
    ClosePositionBody,
    ScreenerRequest,
    is_option_symbol,
)
from alpaca.data.live import StockDataStream
from alpaca.data.live.option import OptionDataStream

logger = logging.getLogger(__name__)

# FastAPI app
app = FastAPI(title="Owl Street View API", version="1.0.0")

# Setup CORS (allows local React dev servers on 3000 and 5173)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global services initialized at startup
alpaca_service: Optional[AlpacaService] = None
dashboard_password: Optional[str] = None
pulse_url: str = "http://localhost:8000"


# Request timing middleware for telemetry
@app.middleware("http")
async def request_timing_middleware(request: Request, call_next):
    import time
    start = time.perf_counter()
    response = await call_next(request)
    elapsed_ms = (time.perf_counter() - start) * 1000
    response.headers["X-Server-Timing-Ms"] = f"{elapsed_ms:.2f}"
    return response

# Dependency to check password auth cookie
def verify_dashboard_password(request: Request):
    global dashboard_password
    if not dashboard_password or dashboard_password.strip() == "":
        return True
    
    token = request.cookies.get("session_token")
    if token != dashboard_password:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return True

@app.on_event("startup")
def startup_event():
    config_path = os.environ.get("WEB_CONFIG_PATH", "config/config.yaml")
    if not os.path.exists(config_path):
        logger.warning(f"Config file not found at '{config_path}'. Running without Alpaca Client initialized.")
        return
    try:
        from src.config import load_config
        config = load_config(config_path)
        init_web_service(config)
        logger.info(f"Loaded config from '{config_path}' and initialized Alpaca Service.")
    except Exception as e:
        logger.error(f"Error loading configuration during startup: {e}", exc_info=True)

def init_web_service(config: AppConfig):
    global alpaca_service, dashboard_password, pulse_url
    dashboard_password = config.dashboard_password
    pulse_url = config.pulse_url
    
    is_paper = config.alpaca.mode.lower() == "paper"
    alpaca_service = AlpacaService(
        api_key=config.alpaca.api_key,
        secret_key=config.alpaca.api_secret,
        is_paper=is_paper,
        fmp_api_key=config.fmp.api_key
    )
    logger.info("AlpacaService initialized in web app.")

# ── Authentication Routes ──────────────────────────────────────────────────────

@app.post("/api/auth/login")
def login(payload: dict, response: Response):
    global dashboard_password
    if not dashboard_password or dashboard_password.strip() == "":
        return {"status": "success", "message": "Auth disabled"}
        
    user_password = payload.get("password")
    if user_password == dashboard_password:
        response.set_cookie(
            key="session_token",
            value=dashboard_password,
            httponly=True,
            samesite="lax",
            max_age=30 * 24 * 3600  # 30 days
        )
        return {"status": "success", "message": "Logged in successfully"}
    
    raise HTTPException(status_code=400, detail="Invalid password")

@app.post("/api/auth/logout")
def logout(response: Response):
    response.delete_cookie("session_token")
    return {"status": "success"}

@app.get("/api/status")
def get_status(request: Request):
    global dashboard_password, alpaca_service, pulse_url
    
    # Check if authorized
    auth_required = bool(dashboard_password and dashboard_password.strip() != "")
    authorized = False
    
    if auth_required:
        token = request.cookies.get("session_token")
        authorized = (token == dashboard_password)
    else:
        authorized = True

    pulse_online = False
    if pulse_url:
        import httpx
        try:
            response = httpx.get(pulse_url, timeout=1.0)
            if response.status_code == 200:
                pulse_online = True
        except Exception:
            pass

    return {
        "status": "online",
        "auth_enabled": auth_required,
        "authorized": authorized,
        "alpaca_mode": alpaca_service.is_paper if alpaca_service else "unknown",
        "pulse_url": pulse_url,
        "pulse_online": pulse_online
    }



# ── Trading & Account Routes (Protected) ───────────────────────────────────────

@app.get("/api/account", dependencies=[Depends(verify_dashboard_password)])
def get_account():
    try:
        return alpaca_service.get_account()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/clock", dependencies=[Depends(verify_dashboard_password)])
def get_clock():
    try:
        return alpaca_service.get_market_clock()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/positions", dependencies=[Depends(verify_dashboard_password)])
def get_positions():
    try:
        return alpaca_service.get_positions()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/positions/close", dependencies=[Depends(verify_dashboard_password)])
def close_position(body: ClosePositionBody):
    try:
        return alpaca_service.close_position(body.symbol, body.qty)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/orders", dependencies=[Depends(verify_dashboard_password)])
def get_orders(status: str = "open", limit: int = 100):
    try:
        return alpaca_service.get_orders(status, limit)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/orders/submit", dependencies=[Depends(verify_dashboard_password)])
def submit_advanced_order(body: AdvancedOrderBody):
    try:
        return alpaca_service.submit_advanced_order(body)
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/orders/market", dependencies=[Depends(verify_dashboard_password)])
def place_market_order(body: MarketOrderBody):
    try:
        adv = AdvancedOrderBody(
            symbol=body.symbol,
            qty=body.qty,
            side=body.side,
            time_in_force=body.time_in_force,
            order_type="market",
        )
        return alpaca_service.submit_advanced_order(adv)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/orders/limit", dependencies=[Depends(verify_dashboard_password)])
def place_limit_order(body: LimitOrderBody):
    try:
        adv = AdvancedOrderBody(
            symbol=body.symbol,
            qty=body.qty,
            side=body.side,
            time_in_force=body.time_in_force,
            order_type="limit",
            limit_price=body.limit_price,
        )
        return alpaca_service.submit_advanced_order(adv)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/orders/{order_id}", dependencies=[Depends(verify_dashboard_password)])
def get_order_detail(order_id: str, nested: bool = True):
    try:
        return alpaca_service.get_order_detail(order_id, nested)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.patch("/api/orders/{order_id}", dependencies=[Depends(verify_dashboard_password)])
def replace_order(order_id: str, body: ReplaceOrderBody):
    try:
        return alpaca_service.replace_order(order_id, body)
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.delete("/api/orders/{order_id}", dependencies=[Depends(verify_dashboard_password)])
def cancel_order(order_id: str):
    try:
        return alpaca_service.cancel_order(order_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# ── Market Data Routes (Protected) ─────────────────────────────────────────────

@app.get("/api/quote/{symbol}", dependencies=[Depends(verify_dashboard_password)])
def get_quote(symbol: str):
    try:
        return alpaca_service.get_quote(symbol)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/snapshot/{symbol}", dependencies=[Depends(verify_dashboard_password)])
def get_snapshot(symbol: str):
    try:
        return alpaca_service.get_snapshot(symbol)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/bars/{symbol}", dependencies=[Depends(verify_dashboard_password)])
def get_bars(symbol: str, timeframe: str = "1D", start: Optional[str] = None, end: Optional[str] = None, limit: Optional[int] = None):
    try:
        return alpaca_service.get_bars(symbol, timeframe, start, end, limit)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/option-expirations/{underlying}", dependencies=[Depends(verify_dashboard_password)])
def get_option_expirations(underlying: str, horizon_days: int = 548):
    try:
        return alpaca_service.get_option_expirations(underlying, horizon_days)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/option-chain/{underlying}", dependencies=[Depends(verify_dashboard_password)])
def get_option_chain(underlying: str, expiration_date: Optional[str] = None, contract_type: Optional[str] = None, limit: int = 80):
    try:
        return alpaca_service.get_option_chain(underlying, expiration_date, contract_type, limit)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/option-chain-matrix/{underlying}", dependencies=[Depends(verify_dashboard_password)])
def get_option_chain_matrix(underlying: str, expiration_date: str, wing: int = 32, center_strike: Optional[float] = None):
    try:
        return alpaca_service.get_option_chain_matrix(underlying, expiration_date, wing, center_strike)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/screener", dependencies=[Depends(verify_dashboard_password)])
def run_screener(body: ScreenerRequest):
    try:
        return alpaca_service.run_screener(body)
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# ── WebSocket live quotes ─────────────────────────────────────────────────────

@app.websocket("/ws/quotes")
async def websocket_quotes(websocket: WebSocket):
    global alpaca_service
    await websocket.accept()
    
    if not alpaca_service:
        await websocket.close(code=1008, reason="Alpaca Service not initialized")
        return
        
    stock_stream: Optional[StockDataStream] = None
    option_stream: Optional[OptionDataStream] = None
    stock_task: Optional[asyncio.Task] = None
    option_task: Optional[asyncio.Task] = None

    async def handle_quote(quote):
        msg = {
            "symbol": quote.symbol,
            "ask_price": float(quote.ask_price),
            "bid_price": float(quote.bid_price),
            "timestamp": quote.timestamp.isoformat(),
        }
        try:
            await websocket.send_text(json.dumps(msg))
        except Exception:
            pass

    def subscribe_partitioned(symbols: list[str]) -> None:
        nonlocal stock_stream, option_stream, stock_task, option_task
        stocks = [s for s in symbols if not is_option_symbol(s)]
        opts = [s for s in symbols if is_option_symbol(s)]
        
        if stocks:
            if stock_stream is None:
                stock_stream = StockDataStream(alpaca_service.api_key, alpaca_service.secret_key)
                stock_stream.subscribe_quotes(handle_quote, *stocks)
                stock_task = asyncio.create_task(stock_stream.run())
            else:
                stock_stream.subscribe_quotes(handle_quote, *stocks)
        if opts:
            if option_stream is None:
                option_stream = OptionDataStream(alpaca_service.api_key, alpaca_service.secret_key)
                option_stream.subscribe_quotes(handle_quote, *opts)
                option_task = asyncio.create_task(option_stream.run())
            else:
                option_stream.subscribe_quotes(handle_quote, *opts)

    try:
        # Initial subscription
        data = await asyncio.wait_for(websocket.receive_text(), timeout=30)
        msg = json.loads(data)
        if msg.get("action") == "subscribe" and msg.get("symbols"):
            subscribe_partitioned([s.upper() for s in msg["symbols"]])
            
            # Keep receiving additional subscriptions
            while True:
                raw = await websocket.receive_text()
                update = json.loads(raw)
                if update.get("action") == "subscribe":
                    new_syms = [s.upper() for s in update.get("symbols", [])]
                    if new_syms:
                        subscribe_partitioned(new_syms)
    except (WebSocketDisconnect, asyncio.TimeoutError):
        pass
    finally:
        for stream in (stock_stream, option_stream):
            if stream is not None:
                try:
                    stream.stop()
                except Exception:
                    pass
        for task in (stock_task, option_task):
            if task is not None:
                task.cancel()

# ── Serve React Static Assets ────────────────────────────────────────────────

frontend_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend", "build")
if os.path.exists(frontend_dir):
    logger.info(f"Serving frontend static build from: {frontend_dir}")
    
    # Mount static assets directory
    static_assets_path = os.path.join(frontend_dir, "static")
    if os.path.exists(static_assets_path):
        app.mount("/static", StaticFiles(directory=static_assets_path), name="static")
    
    # Fallback to index.html for client side routing
    @app.get("/{full_path:path}", response_class=HTMLResponse)
    def serve_frontend(full_path: str):
        if full_path.startswith("api") or full_path.startswith("ws"):
            raise HTTPException(status_code=404)
        index_file = os.path.join(frontend_dir, "index.html")
        if os.path.exists(index_file):
            with open(index_file, "r") as f:
                return HTMLResponse(content=f.read())
        return HTMLResponse(content="<h1>Frontend index.html not found!</h1>", status_code=404)
else:
    logger.warning("Frontend build directory 'frontend/build' not found. App will run in API-only mode.")
