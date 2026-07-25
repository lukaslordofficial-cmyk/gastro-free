"""
Delta-Scraper — silnik monitorowania stron dostawców.

STATUS (2026-07): WYŁĄCZONY W PRODUKCJI / UI.
  - Frontend (przyciski, modal) usunięty z aplikacji Gastro Manager.
  - Endpointy API w server.py zwracają 410 Gone.
  - Ten pakiet zostaje w repozytorium na ewentualny powrót w innych produktach.

Uruchomienie lokalne (dev / inne aplikacje):
  from delta_scraper.engine import check_target_record, check_all_targets
"""

from delta_scraper.engine import check_target_record, check_all_targets
from delta_scraper.models import ScrapedProduct, ChangeEvent, CheckResult

__all__ = [
    "ScrapedProduct",
    "ChangeEvent",
    "CheckResult",
    "check_target_record",
    "check_all_targets",
]
