"""
Lokalni Przetwórcy — checkout, shipping, faktury, etykiety.
Mutacje restauracji wymagają require_tenant_account_key().
"""
from __future__ import annotations

from fastapi import APIRouter, Request

router = APIRouter(tags=["local-producers"])


def _tenant():
    from server import require_tenant_account_key
    return require_tenant_account_key()


@router.get("/api/local-producers/commerce-status")
async def local_producers_commerce_status():
    from server import local_producers_commerce_status as _impl
    return await _impl()


@router.post("/api/local-producers/courier-quotes")
async def local_producers_courier_quotes(request: Request):
    _tenant()
    from server import LpCourierQuoteRequest, local_producers_courier_quotes as _impl
    body = await request.json()
    return await _impl(LpCourierQuoteRequest.model_validate(body))


@router.post("/api/local-producers/checkout")
async def local_producers_checkout(request: Request):
    _tenant()
    from server import LpCheckoutRequest, local_producers_checkout as _impl
    body = await request.json()
    return await _impl(LpCheckoutRequest.model_validate(body))


@router.get("/api/local-producers/billing-return")
async def local_producers_billing_return(
    status: str = "success",
    session_id: str = "",
    app: str = "",
):
    from server import local_producers_billing_return as _impl
    return await _impl(status=status, session_id=session_id, app=app)


@router.post("/api/local-producers/confirm-payment")
async def local_producers_confirm_payment(request: Request):
    _tenant()
    from server import LpConfirmRequest, local_producers_confirm_payment as _impl
    body = await request.json()
    return await _impl(LpConfirmRequest.model_validate(body))


@router.post("/producer/products/nowy")
@router.post("/api/producer/products/nowy")
@router.post("/api/local-producers/products")
async def producer_products_create(request: Request):
    # Auth dystrybutora w implementacji (JWT), nie X-Account-Key restauracji
    from server import LpProductCreateRequest, producer_products_create as _impl
    body = await request.json()
    return await _impl(LpProductCreateRequest.model_validate(body), request)


@router.post("/api/local-producers/orders/{order_id}/mark-handed-to-courier")
async def local_producers_mark_handed_to_courier(order_id: str, request: Request):
    from server import local_producers_mark_handed_to_courier as _impl
    return await _impl(order_id, request)


@router.post("/api/local-producers/orders/{order_id}/mark-received")
async def local_producers_mark_received(order_id: str):
    _tenant()
    from server import local_producers_mark_received as _impl
    return await _impl(order_id)


@router.post("/api/local-producers/create-shipment")
async def local_producers_create_shipment(request: Request):
    _tenant()
    from server import LpShipmentRequest, local_producers_create_shipment as _impl
    body = await request.json()
    return await _impl(LpShipmentRequest.model_validate(body))


@router.get("/api/local-producers/orders/{order_id}/shipping")
@router.post("/api/local-producers/orders/{order_id}/sync-tracking")
async def producer_order_shipping(order_id: str, request: Request):
    from server import producer_order_shipping as _impl
    return await _impl(order_id, request)


@router.post("/api/local-producers/orders/{order_id}/retry-shipment")
async def producer_order_retry_shipment(order_id: str, request: Request):
    _tenant()
    from server import producer_order_retry_shipment as _impl
    return await _impl(order_id, request)


@router.get("/api/local-producers/orders/{order_id}/invoice-url")
async def producer_order_invoice_url(order_id: str, request: Request):
    from server import producer_order_invoice_url as _impl
    return await _impl(order_id, request)


@router.get("/api/orders/{order_id}/invoice")
@router.get("/api/local-producers/orders/{order_id}/invoice")
async def producer_order_invoice_file(order_id: str, request: Request):
    from server import producer_order_invoice_file as _impl
    return await _impl(order_id, request)


@router.get("/api/orders/{order_id}/furgonetka-label")
@router.get("/api/orders/{order_id}/label")
@router.get("/api/producer-orders/{order_id}/label")
@router.get("/api/local-producers/orders/{order_id}/label")
async def producer_order_furgonetka_label(order_id: str, request: Request):
    from server import producer_order_furgonetka_label as _impl
    return await _impl(order_id, request)
