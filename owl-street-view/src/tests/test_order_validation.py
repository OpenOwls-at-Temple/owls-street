from fastapi import HTTPException

import pytest
from src.alpaca_service import AlpacaService

# Initialize a dummy service instance for validation testing
service = AlpacaService(api_key="dummy", secret_key="dummy")

def test_parse_side_buy_sell():
    assert str(service._parse_side("buy")).lower().endswith("buy")
    assert str(service._parse_side("sell")).lower().endswith("sell")


def test_parse_side_invalid():
    try:
        service._parse_side("hold")
        assert False, "expected HTTPException"
    except HTTPException as e:
        assert e.status_code == 400


def test_parse_tif_supported():
    assert str(service._parse_tif("day")).lower().endswith("day")
    assert str(service._parse_tif("gtc")).lower().endswith("gtc")
    assert str(service._parse_tif("ioc")).lower().endswith("ioc")
    assert str(service._parse_tif("fok")).lower().endswith("fok")


def test_parse_order_class_supported():
    assert str(service._parse_order_class("simple")).lower().endswith("simple")
    assert str(service._parse_order_class("bracket")).lower().endswith("bracket")
    assert str(service._parse_order_class("oco")).lower().endswith("oco")
    assert str(service._parse_order_class("oto")).lower().endswith("oto")
