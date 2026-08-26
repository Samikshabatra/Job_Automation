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


FILE_INPUTS = pathlib.Path(__file__).parent / "fixtures" / "file_inputs_form.html"


async def _file_input_page(body: str):
    pw = await async_playwright().start()
    browser = await pw.chromium.launch()
    ctx = await browser.new_context()
    page = await ctx.new_page()
    await page.route("**/*", lambda route: route.fulfill(body=body, content_type="text/html"))
    await page.goto("https://jobs.ashbyhq.com/acme/abc/application")
    return pw, browser, page


async def _uploaded_names(page):
    """The filename held by each file input, in DOM order."""
    return await page.evaluate(
        "() => Array.from(document.querySelectorAll('input[type=file]'))"
        ".map(e => e.files && e.files[0] ? e.files[0].name : '')"
    )


@pytest.mark.asyncio
async def test_resume_goes_to_the_resume_field_not_the_first_file_input(tmp_path):
    # The bug this replaces: `input[type=file]` .first fed Ashby's "autofill
    # from resume" helper, which sits above the form. The resume was uploaded
    # every time -- into the wrong control -- and the required Resume field
    # stayed empty, forcing the whole application to manual review.
    cv = tmp_path / "resume.pdf"
    cv.write_bytes(b"%PDF-1.4 fake")

    pw, browser, page = await _file_input_page(FILE_INPUTS.read_text())
    try:
        await fill_form(page, {}, resume_path=str(cv))
        names = await _uploaded_names(page)
        assert names[0] == ""            # the autofill helper is left alone
        assert names[1] == "resume.pdf"  # the Resume field gets it
        assert names[2] == ""            # Additional Attachments is left alone
    finally:
        await browser.close(); await pw.stop()


@pytest.mark.asyncio
async def test_a_lone_unlabelled_file_input_still_receives_the_resume(tmp_path):
    # Plenty of forms have exactly one file input and no label worth reading.
    # With nothing to confuse it for, it is the resume field.
    cv = tmp_path / "resume.pdf"
    cv.write_bytes(b"%PDF-1.4 fake")

    body = "<html><body><form><input type='file' /></form></body></html>"
    pw, browser, page = await _file_input_page(body)
    try:
        await fill_form(page, {}, resume_path=str(cv))
        assert (await _uploaded_names(page)) == ["resume.pdf"]
    finally:
        await browser.close(); await pw.stop()


@pytest.mark.asyncio
async def test_nothing_is_uploaded_when_no_input_looks_like_a_resume(tmp_path):
    # Two candidates, neither of them a resume field. Guessing would attach the
    # CV to a cover-letter or portfolio slot; leaving it forces manual review,
    # which is the correct outcome.
    cv = tmp_path / "resume.pdf"
    cv.write_bytes(b"%PDF-1.4 fake")

    body = ("<html><body><form>"
            "<label for='a'>Cover Letter</label><input type='file' id='a' />"
            "<label for='b'>Portfolio</label><input type='file' id='b' />"
            "</form></body></html>")
    pw, browser, page = await _file_input_page(body)
    try:
        await fill_form(page, {}, resume_path=str(cv))
        assert (await _uploaded_names(page)) == ["", ""]
    finally:
        await browser.close(); await pw.stop()


@pytest.mark.asyncio
async def test_a_cv_labelled_field_is_recognised(tmp_path):
    cv = tmp_path / "resume.pdf"
    cv.write_bytes(b"%PDF-1.4 fake")

    body = ("<html><body><form>"
            "<input type='file' />"
            "<label for='c'>Upload your CV</label><input type='file' id='c' />"
            "</form></body></html>")
    pw, browser, page = await _file_input_page(body)
    try:
        await fill_form(page, {}, resume_path=str(cv))
        assert (await _uploaded_names(page)) == ["", "resume.pdf"]
    finally:
        await browser.close(); await pw.stop()


@pytest.mark.asyncio
async def test_a_form_with_no_file_input_is_not_an_error(tmp_path):
    cv = tmp_path / "resume.pdf"
    cv.write_bytes(b"%PDF-1.4 fake")

    body = "<html><body><form><input name='email' type='email' /></form></body></html>"
    pw, browser, page = await _file_input_page(body)
    try:
        await fill_form(page, {}, resume_path=str(cv))  # must not raise
    finally:
        await browser.close(); await pw.stop()


COMBO = pathlib.Path(__file__).parent / "fixtures" / "combobox_form.html"


async def _combo_page():
    pw = await async_playwright().start()
    browser = await pw.chromium.launch()
    ctx = await browser.new_context()
    page = await ctx.new_page()
    await page.route("**/*", lambda route: route.fulfill(body=COMBO.read_text(), content_type="text/html"))
    await page.goto("https://jobs.ashbyhq.com/acme/abc/application")
    return pw, browser, page


async def _combo_values(page):
    return await page.evaluate(
        "() => Array.from(document.querySelectorAll('input[role=combobox]')).map(e => e.value)")


@pytest.mark.asyncio
async def test_location_type_ahead_is_filled_by_choosing_the_matching_option():
    # The value only exists once an option is chosen. Typing alone leaves the
    # field empty, which is what happened before: a required field silently
    # blank on every application.
    pw, browser, page = await _combo_page()
    try:
        await fill_form(page, {}, resume_path=None, location="Bengaluru, Karnataka, India")
        assert (await _combo_values(page))[0] == "Bengaluru, Karnataka, India"
    finally:
        await browser.close(); await pw.stop()


@pytest.mark.asyncio
async def test_a_type_ahead_that_is_not_about_location_is_left_alone():
    # "Which team interests you?" is a question about the job, not about the
    # candidate. Typing a city into it would submit a nonsense answer.
    pw, browser, page = await _combo_page()
    try:
        await fill_form(page, {}, resume_path=None, location="Bengaluru, Karnataka, India")
        assert (await _combo_values(page))[1] == ""
    finally:
        await browser.close(); await pw.stop()


@pytest.mark.asyncio
async def test_nothing_is_chosen_when_no_option_matches_the_candidate():
    # Selecting a nearby city because it happened to be first would put a wrong
    # address on a real application. A blank required field forces manual
    # review, which is the right outcome.
    pw, browser, page = await _combo_page()
    try:
        await fill_form(page, {}, resume_path=None, location="Reykjavik, Iceland")
        assert (await _combo_values(page))[0] == ""
    finally:
        await browser.close(); await pw.stop()


@pytest.mark.asyncio
async def test_the_closest_option_wins_over_a_merely_similar_one():
    # "Bengaluru Rural, Karnataka, India" also contains the typed city. The
    # exact match for the candidate's stated location must be preferred.
    pw, browser, page = await _combo_page()
    try:
        await fill_form(page, {}, resume_path=None, location="Bengaluru, Karnataka, India")
        assert (await _combo_values(page))[0] == "Bengaluru, Karnataka, India"
    finally:
        await browser.close(); await pw.stop()


@pytest.mark.asyncio
async def test_no_location_supplied_leaves_every_type_ahead_untouched():
    pw, browser, page = await _combo_page()
    try:
        await fill_form(page, {}, resume_path=None)
        assert (await _combo_values(page)) == ["", ""]
    finally:
        await browser.close(); await pw.stop()


@pytest.mark.asyncio
async def test_a_form_with_no_type_ahead_is_not_an_error():
    pw = await async_playwright().start()
    browser = await pw.chromium.launch()
    ctx = await browser.new_context()
    page = await ctx.new_page()
    await ctx.route("**/*", lambda route: route.fulfill(
        body="<html><body><form><input name='email' type='email' /></form></body></html>",
        content_type="text/html"))
    await page.goto("https://jobs.ashbyhq.com/acme/abc/application")
    try:
        await fill_form(page, {"email": "me@x.com"}, resume_path=None, location="Bengaluru, Karnataka, India")
        assert await page.input_value("[name=email]") == "me@x.com"
    finally:
        await browser.close(); await pw.stop()
