from resume_agent.repair import repair_hint


def test_empty_offending_returns_empty_hint():
    assert repair_hint([]) == ""


def test_hint_lists_invented_names_to_remove():
    h = repair_hint(["Built X at Google (invented names: Google, ETL)"])
    assert "Google" in h and "ETL" in h
    assert "remove" in h.lower()


def test_hint_flags_invented_figures():
    h = repair_hint(["Grew revenue 12x (invented figures: 12b)"])
    assert "12b" in h
    assert "number" in h.lower()


def test_hint_treats_a_bare_bullet_as_a_reword_too_far():
    h = repair_hint(["Completely unrelated claim about rocket engines"])
    assert "rocket engines" in h
    assert "closer" in h.lower()


def test_hint_combines_multiple_offending_kinds():
    h = repair_hint([
        "Bullet one (invented names: TensorFlow)",
        "Bullet two (invented figures: 99%)",
        "Bullet three reworded beyond recognition",
    ])
    assert "TensorFlow" in h and "99%" in h and "Bullet three reworded beyond recognition" in h
