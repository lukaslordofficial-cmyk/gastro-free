from inventory_name_match import find_inventory_match


def test_marchew_matches_marchewka():
    inv = [{"id": "1", "name": "Marchewka", "quantity": 0, "unit": "kg"}]
    hit = find_inventory_match("marchew", inv)
    assert hit and hit["id"] == "1"


def test_baklazan_variants():
    inv = [{"id": "2", "name": "Bakłażan", "quantity": 1, "unit": "kg"}]
    assert find_inventory_match("baklazany", inv)
    assert find_inventory_match("BAKŁAŻAN", inv)


def test_no_false_merge_unrelated():
    inv = [{"id": "3", "name": "Marchewka", "quantity": 0, "unit": "kg"}]
    assert find_inventory_match("pomidor", inv) is None
