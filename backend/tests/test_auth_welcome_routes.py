"""Welcome e-mail route wiring + HTML helper."""
from auth_welcome_routes import build_welcome_email_html, router


def test_welcome_router_wired():
    paths = {getattr(r, "path", None) for r in router.routes}
    assert "/api/auth/welcome-email" in paths


def test_welcome_html_includes_verify_link():
    html, text = build_welcome_email_html(
        restaurant_name="Bistro Test",
        verify_link="https://example.com/verify?token=abc",
    )
    assert "Bistro Test" in html
    assert "https://example.com/verify?token=abc" in html
    assert "Potwierdź e-mail" in html
    assert "https://example.com/verify?token=abc" in text


def test_welcome_html_without_link():
    html, text = build_welcome_email_html(restaurant_name=None, verify_link=None)
    assert "Witaj w gronie" in html
    assert "Zaloguj się" in html
    assert "kontakt@gastromanager.org" in text
