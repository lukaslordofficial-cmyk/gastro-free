"""Unit tests for LP invoice storage ref → signed URL helpers."""
from lp_invoice_url import order_invoice_raw, parse_invoice_storage_ref


def test_parse_http_url():
    p = parse_invoice_storage_ref("https://cdn.example.com/a.pdf")
    assert p == {"kind": "http", "url": "https://cdn.example.com/a.pdf"}


def test_parse_bucket_path():
    p = parse_invoice_storage_ref("producer-documents:orders/abc/invoice.pdf")
    assert p == {
        "kind": "storage",
        "bucket": "producer-documents",
        "path": "orders/abc/invoice.pdf",
    }


def test_parse_bare_path_defaults_bucket():
    p = parse_invoice_storage_ref("orders/x/f.pdf")
    assert p == {
        "kind": "storage",
        "bucket": "producer-documents",
        "path": "orders/x/f.pdf",
    }


def test_order_invoice_raw_prefers_invoice_url():
    assert (
        order_invoice_raw(
            {
                "invoice_url": "producer-documents:a.pdf",
                "settlement_invoice_url": "https://x",
            }
        )
        == "producer-documents:a.pdf"
    )
