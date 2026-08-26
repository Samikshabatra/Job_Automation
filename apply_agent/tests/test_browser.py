# apply_agent/tests/test_browser.py
import pathlib
import pytest
import pytest_asyncio
from playwright.async_api import async_playwright
from apply_agent.browser import read_fields, fill_form, open_form

FIX = pathlib.Path(__file__).parent / "fixtures" / "greenhouse_form.html"


async def _page():
    pw = await async_playwright().start()
    browser = await pw.chromium.launch()
    ctx = await browser.new_context()
    page = await ctx.new_page()
    await page.route("**/*", lambda route: route.fulfill(body=FIX.read_text(), content_type="text/html"))
    await page.goto("https://boards.greenhouse.io/acme/jobs/1")
    return pw, browser, page


@pytest.mark.asyncio
async def test_reads_named_inputs_from_the_form():
    pw, browser, page = await _page()
    try:
        names = {f.name for f in await read_fields(page)}
        assert {"first_name", "last_name", "email"} <= names
    finally:
        await browser.close(); await pw.stop()


@pytest.mark.asyncio
async def test_fill_sets_input_values():
    pw, browser, page = await _page()
    try:
        await fill_form(page, {"first_name": "Samiksha", "email": "me@x.com"}, resume_path=None)
        assert await page.input_value("[name=first_name]") == "Samiksha"
    finally:
        await browser.close(); await pw.stop()


@pytest.mark.asyncio
async def test_read_fields_skips_hidden_inputs():
    pw, browser, page = await _page()
    try:
        names = {f.name for f in await read_fields(page)}
        assert "csrf_token" not in names
        assert {"first_name", "last_name", "email"} <= names
    finally:
        await browser.close(); await pw.stop()


@pytest.mark.asyncio
async def test_fill_form_uploads_resume(tmp_path):
    resume = tmp_path / "resume.pdf"
    resume.write_bytes(b"%PDF-1.4 fake resume content")

    pw, browser, page = await _page()
    try:
        await fill_form(page, {"first_name": "Samiksha"}, resume_path=str(resume))
        file_count = await page.locator("input[type=file]").first.evaluate("el => el.files.length")
        file_name = await page.locator("input[type=file]").first.evaluate("el => el.files[0].name")
        assert file_count == 1
        assert file_name == "resume.pdf"
    finally:
        await browser.close(); await pw.stop()


# --- React-shaped forms: identity in `id`/`aria-label`, no `name` ------------
# The live run against PhonePe filled nothing: read_fields required a `name`
# attribute and only 2 of the form's 50 fields had one.

REACT_FIX = pathlib.Path(__file__).parent / "fixtures" / "greenhouse_form_react.html"


async def _react_page():
    pw = await async_playwright().start()
    browser = await pw.chromium.launch()
    ctx = await browser.new_context()
    page = await ctx.new_page()
    await page.route("**/*", lambda route: route.fulfill(body=REACT_FIX.read_text(), content_type="text/html"))
    await page.goto("https://job-boards.greenhouse.io/acme/jobs/1")
    return pw, browser, page


@pytest.mark.asyncio
async def test_reads_id_only_inputs():
    pw, browser, page = await _react_page()
    try:
        keys = {f.key for f in await read_fields(page)}
        assert {"first_name", "last_name", "email", "phone"} <= keys
    finally:
        await browser.close(); await pw.stop()


@pytest.mark.asyncio
async def test_still_skips_hidden_inputs_without_a_name():
    pw, browser, page = await _react_page()
    try:
        keys = {f.key for f in await read_fields(page)}
        assert "csrf_token" not in keys
    finally:
        await browser.close(); await pw.stop()


@pytest.mark.asyncio
async def test_prefers_name_over_id_when_both_exist():
    pw, browser, page = await _react_page()
    try:
        keys = {f.key for f in await read_fields(page)}
        assert "notice_period" in keys
    finally:
        await browser.close(); await pw.stop()


@pytest.mark.asyncio
async def test_aria_label_becomes_the_label_for_id_only_fields():
    pw, browser, page = await _react_page()
    try:
        by_key = {f.key: f for f in await read_fields(page)}
        assert by_key["first_name"].label == "First Name"
    finally:
        await browser.close(); await pw.stop()


@pytest.mark.asyncio
async def test_fill_sets_values_on_id_only_inputs():
    pw, browser, page = await _react_page()
    try:
        await fill_form(page, {"first_name": "Samiksha", "email": "me@x.com"}, resume_path=None)
        assert await page.input_value("#first_name") == "Samiksha"
        assert await page.input_value("#email") == "me@x.com"
    finally:
        await browser.close(); await pw.stop()


@pytest.mark.asyncio
async def test_fill_still_works_on_named_inputs():
    pw, browser, page = await _react_page()
    try:
        await fill_form(page, {"notice_period": "30 days"}, resume_path=None)
        assert await page.input_value("[name=notice_period]") == "30 days"
    finally:
        await browser.close(); await pw.stop()


@pytest.mark.asyncio
async def test_aria_required_counts_as_required():
    """`unmapped` is one of the two gates that force manual review, and it is
    fed only by fields marked required. React forms mark most of theirs with
    aria-required rather than the `required` attribute -- 26 vs 12 on the live
    PhonePe posting -- so reading only `required` left required questions
    invisible to the gate."""
    pw, browser, page = await _react_page()
    try:
        by_key = {f.key: f for f in await read_fields(page)}
        assert by_key["notice_period_q"].required is True
        assert by_key["expected_ctc"].required is True     # plain `required` still works
        assert by_key["phone"].required is False           # neither marker -> not required
    finally:
        await browser.close(); await pw.stop()


SPA = pathlib.Path(__file__).parent / "fixtures" / "spa_form.html"


async def _spa_context():
    """A browser context serving a form that only exists after the app mounts."""
    pw = await async_playwright().start()
    browser = await pw.chromium.launch()
    ctx = await browser.new_context()
    await ctx.route("**/*", lambda route: route.fulfill(body=SPA.read_text(), content_type="text/html"))
    return pw, browser, ctx


@pytest.mark.asyncio
async def test_open_form_waits_for_a_client_rendered_form():
    # Ashby postings, and modern Greenhouse ones, render their fields in
    # JavaScript. Returning at domcontentloaded hands back an empty document,
    # read_fields finds nothing, and the agent decides the posting has no form
    # and routes a perfectly good job to manual review.
    pw, browser, ctx = await _spa_context()
    try:
        page = await open_form(ctx, "https://jobs.ashbyhq.com/acme/abc-123")
        names = {f.name for f in await read_fields(page)}
        assert {"first_name", "last_name", "email"} <= names
    finally:
        await browser.close(); await pw.stop()


@pytest.mark.asyncio
async def test_open_form_returns_a_page_when_no_form_ever_appears():
    # A closed posting, a login wall or a plain article has no fields and never
    # will. That must come back as an empty form for the caller to route, not
    # as an exception that marks the job failed.
    pw = await async_playwright().start()
    browser = await pw.chromium.launch()
    ctx = await browser.new_context()
    await ctx.route(
        "**/*",
        lambda route: route.fulfill(body="<html><body><p>Position closed</p></body></html>",
                                    content_type="text/html"),
    )
    try:
        page = await open_form(ctx, "https://jobs.ashbyhq.com/acme/gone")
        assert await read_fields(page) == []
    finally:
        await browser.close(); await pw.stop()


LABELLED = pathlib.Path(__file__).parent / "fixtures" / "labelled_form.html"


@pytest_asyncio.fixture(scope="module")
async def labelled_fields():
    """Read the label fixture once and share the result.

    Every assertion below inspects the same static page, and launching a
    Chromium per assertion made the suite slow enough that browser startup
    began timing out under its own load. One launch, one read, six checks.
    """
    pw = await async_playwright().start()
    browser = await pw.chromium.launch()
    try:
        ctx = await browser.new_context()
        page = await ctx.new_page()
        await page.route("**/*", lambda route: route.fulfill(body=LABELLED.read_text(), content_type="text/html"))
        await page.goto("https://jobs.ashbyhq.com/acme/abc/application")
        yield {f.key: f for f in await read_fields(page)}
    finally:
        await browser.close(); await pw.stop()


async def test_label_for_supplies_the_identity_of_a_uuid_keyed_field(labelled_fields):
    # Ashby gives custom questions opaque UUID names. Without the <label for>
    # the mapper sees "3fdc76ed-6ac2-..." and can map nothing, so an ordinary
    # phone box lands in `unmapped` and forces the whole form to manual review.
    assert labelled_fields["3fdc76ed-6ac2-497a-a6cc-e07ed517ec1d"].label == "Phone Number"


async def test_a_real_label_beats_a_generic_placeholder(labelled_fields):
    # "Type here..." is not a description of anything. Preferring it over the
    # label was actively destroying the only usable identity on the field.
    assert labelled_fields["_systemfield_name"].label == "Full Name"


async def test_aria_labelledby_is_resolved_to_its_text(labelled_fields):
    assert labelled_fields["f63fdc3f-8d4c-49fc-9388-3a9ef836de55"].label == "LinkedIn Profile, if available"


async def test_a_wrapping_label_is_used_when_there_is_no_for_attribute(labelled_fields):
    assert labelled_fields["c779ac6e-4fe0-4dfe-9dfa-acd7e2823ba7"].label == "Where have you most recently worked?"


async def test_aria_label_is_used_when_nothing_else_describes_the_field(labelled_fields):
    assert labelled_fields["q_aria"].label == "Expected annual compensation"


async def test_placeholder_still_used_as_the_last_readable_source(labelled_fields):
    # Demoted, not discarded. On a form with no labels at all it is the only
    # human-readable thing left.
    assert labelled_fields["q_placeholder_only"].label == "Notice period in days"
