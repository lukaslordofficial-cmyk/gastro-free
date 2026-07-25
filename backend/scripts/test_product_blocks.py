from delta_scraper.ai_interpreter import extract_potential_product_blocks

html = """
<html>
  <div class="product-card" data-product-id="1">
    <img src="maka.jpg"/>
    <span>Mąka pszenna 1kg</span>
    <span>12,50 zł</span>
  </div>
  <div class="product-card">
    <span>Karton zbiorczy</span>
    <span>1,20 zł</span>
  </div>
  <footer>Dostawa od 15 zł</footer>
</html>
"""

out = extract_potential_product_blocks(html)
print(out)
assert "Mąka" in out or "Maka" in out or "pszenna" in out.lower() or "1kg" in out
print("OK blocks")
