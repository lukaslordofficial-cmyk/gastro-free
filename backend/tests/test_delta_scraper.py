"""Testy jednostkowe silnika Delta-Scrapera (bez sieci)."""
from delta_scraper.crawler import (
    extract_same_domain_links,
    pick_crawl_targets,
    score_product_url,
)
from delta_scraper.differ import diff_products, text_unified_diff
from delta_scraper.hashing import content_hash, normalize_text
from delta_scraper.models import ScrapedProduct
from delta_scraper.parser import extract_products_from_text, normalize_product_key


def test_content_hash_stable():
    t = "Tomato\n12,99 zł\n"
    assert content_hash(t) == content_hash(t)
    assert content_hash(t) != content_hash(t + "x")


def test_normalize_text_strips_empty_lines():
    assert normalize_text("  a \n\n  b  ") == "a\nb"


def test_extract_products_from_text():
    text = """
    Pomidor malinowy 1 kg
    12,99 zł
    Masło extra 200g 8,50 zł
    """
    products = extract_products_from_text(text)
    assert len(products) >= 2
    assert any("masło" in p.name.lower() or "maslo" in normalize_product_key(p.name) for p in products)
    assert any("pomidor" in normalize_product_key(p.name) for p in products)
    assert any(abs(p.price_pln - 12.99) < 0.01 for p in products)


def test_reject_unit_only_name():
    from delta_scraper.parser import is_valid_product_name, extract_products_from_html, extract_products_from_text
    assert not is_valid_product_name("szt")
    assert not is_valid_product_name("szt.")
    assert not is_valid_product_name("text")
    assert not is_valid_product_name("katalog")
    assert not is_valid_product_name("NAME: text")
    assert is_valid_product_name("Schab wieprzowy")
    html = """
    <div class="product-card" data-product-id="SKU-99" data-product-name="Karkówka Sokołów">
      <span class="price">18,50 zł</span>
      <span>szt</span>
    </div>
    <div class="product-card" data-product-id="SKU-100" title="Schab bez kości">
      <img alt="Schab bez kości" />
      <span>24,99 zł</span>
    </div>
    """
    products = extract_products_from_html(html)
    assert len(products) >= 1
    assert all(p.name.lower() != "szt" for p in products)
    assert any(p.product_code for p in products)

    packed = "NAME: Schab wieprzowy | CODE: 55 | TEXT: szt 19,99 zł"
    packed_products = extract_products_from_text(packed)
    assert any("schab" in p.name.lower() for p in packed_products)
    assert not any(p.name.lower().strip() in ("text", "szt") for p in packed_products)


def test_score_skips_pdf_catalog():
    from delta_scraper.crawler import score_product_url
    assert score_product_url("https://hurt.pl/katalog/gazetka.pdf") < 0
    assert score_product_url("https://selgros24.pl/sklep/mieso") > score_product_url("https://hurt.pl/")


def test_diff_price_drop():
    old = [ScrapedProduct(name="Masło 200g", price_pln=10.0)]
    new = [ScrapedProduct(name="Masło 200g", price_pln=8.5)]
    changes = diff_products(old, new)
    assert any(c.change_type == "price_drop" for c in changes)
    drop = next(c for c in changes if c.change_type == "price_drop")
    assert drop.details["price_before"] == 10.0
    assert drop.details["price_after"] == 8.5


def test_diff_new_items():
    old = [ScrapedProduct(name="Mleko", price_pln=4.0)]
    new = old + [ScrapedProduct(name="Jogurt naturalny", price_pln=3.2)]
    changes = diff_products(old, new)
    assert any(c.change_type == "new_items" and c.product_name == "Jogurt naturalny" for c in changes)


def test_unified_diff():
    d = text_unified_diff("linia A\n", "linia B\n")
    assert "linia A" in d or "linia B" in d


def test_score_product_url_prefers_catalog_paths():
    assert score_product_url("https://hurt.pl/katalog/mieso") > score_product_url("https://hurt.pl/")
    assert score_product_url("https://hurt.pl/cennik") > 0
    assert score_product_url("https://hurt.pl/koszyk") < 0
    assert score_product_url("https://hurt.pl/kontakt") < 0


def test_extract_same_domain_links():
    html = """
    <html><body>
      <a href="/katalog/nabial">Nabiał</a>
      <a href="https://other.com/x">Obcy</a>
      <a href="/login">Login</a>
      <a href="https://hurt.pl/produkt/maslo">Masło</a>
    </body></html>
    """
    links = extract_same_domain_links(html, "https://hurt.pl/")
    assert any("/katalog/nabial" in u for u in links)
    assert any("/produkt/maslo" in u for u in links)
    assert not any("other.com" in u for u in links)


def test_pick_crawl_targets_limits():
    seed = "https://hurt.pl/"
    discovered = [
        "https://hurt.pl/katalog/a",
        "https://hurt.pl/katalog/b",
        "https://hurt.pl/login",
        "https://evil.com/katalog",
    ]
    picked = pick_crawl_targets(seed, discovered, max_pages=3)
    assert seed not in picked
    assert len(picked) <= 2
    assert all("evil.com" not in u for u in picked)
    assert all(score_product_url(u) > 0 for u in picked)


def test_default_crawl_limits_raised():
    from delta_scraper.crawler import DEFAULT_MAX_DEPTH, DEFAULT_MAX_PAGES
    assert DEFAULT_MAX_PAGES >= 60
    assert DEFAULT_MAX_DEPTH >= 3
