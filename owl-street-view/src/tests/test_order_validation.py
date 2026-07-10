from fastapi import HTTPException

from main import _parse_order_class, _parse_side, _parse_tif


def test_parse_side_buy_sell():
    assert str(_parse_side("buy")).lower().endswith("buy")
    assert str(_parse_side("sell")).lower().endswith("sell")


def test_parse_side_invalid():
    try:
        _parse_side("hold")
        assert False, "expected HTTPException"
    except HTTPException as e:
        assert e.status_code == 400


def test_parse_tif_supported():
    assert str(_parse_tif("day")).lower().endswith("day")
    assert str(_parse_tif("gtc")).lower().endswith("gtc")
    assert str(_parse_tif("ioc")).lower().endswith("ioc")
    assert str(_parse_tif("fok")).lower().endswith("fok")


def test_parse_order_class_supported():
    assert str(_parse_order_class("simple")).lower().endswith("simple")
    assert str(_parse_order_class("bracket")).lower().endswith("bracket")
    assert str(_parse_order_class("oco")).lower().endswith("oco")
    assert str(_parse_order_class("oto")).lower().endswith("oto")
