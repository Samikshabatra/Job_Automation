# apply_agent/tests/test_urls.py
from apply_agent.urls import application_url

ASHBY = "https://jobs.ashbyhq.com/snowflake/6ced2190-98f0-4ca0-b128-ef655e38d0be"


def test_ashby_posting_url_points_at_the_application_route():
    # The stored URL renders a description with an Apply button and exposes no
    # fields at all. The form is one route further in.
    assert application_url(ASHBY, "ashby") == f"{ASHBY}/application"


def test_ashby_url_that_is_already_the_form_is_left_alone():
    assert application_url(f"{ASHBY}/application", "ashby") == f"{ASHBY}/application"


def test_ashby_trailing_slash_does_not_produce_a_double_slash():
    assert application_url(f"{ASHBY}/", "ashby") == f"{ASHBY}/application"


def test_ashby_url_carrying_a_query_string_is_left_alone():
    # Appending after a query string produces a dead route. Better to open the
    # description and route to manual than to open a 404 and mark it failed.
    tracked = f"{ASHBY}?utm_source=linkedin"
    assert application_url(tracked, "ashby") == tracked


def test_other_platforms_are_returned_unchanged():
    # Greenhouse embeds the form in the posting page itself, and an invented
    # route would turn a working posting into a 404.
    gh = "https://www.mongodb.com/careers/job/?gh_jid=8083366"
    assert application_url(gh, "greenhouse") == gh
    assert application_url(gh, None) == gh
    assert application_url(gh, "workable") == gh


def test_empty_url_is_not_decorated():
    assert application_url("", "ashby") == ""
