# apply_agent/browser.py
from apply_agent.fieldmap import Field


# How long to let a client-rendered application form mount before giving up on
# it. Generous because the cost of waiting is seconds, while the cost of not
# waiting is treating a live posting as though it had no form at all.
FORM_RENDER_TIMEOUT_MS = 10_000


async def open_form(context, url, timeout_ms: int = FORM_RENDER_TIMEOUT_MS):
    """Open `url` and return the page once its form is actually in the DOM.

    `domcontentloaded` alone is not enough. Ashby postings, and modern
    Greenhouse ones, ship an empty root div and render every field in
    JavaScript afterwards; reading at domcontentloaded returns zero fields, and
    the agent then routes a perfectly good job to manual review because it
    believes the posting has no form. A blank screenshot is the symptom.

    Waiting on the fields themselves rather than sleeping a fixed interval
    means a fast page costs nothing and a slow one still succeeds.

    A page that genuinely has no form -- a closed posting, a login wall -- is
    NOT an error: the timeout expires and the page is returned as it is, so the
    caller reads an empty field list and routes the job on its own terms.
    """
    page = await context.new_page()
    await page.goto(url, wait_until="domcontentloaded")
    try:
        await page.wait_for_selector("input, textarea, select", timeout=timeout_ms, state="attached")
    except Exception:
        pass
    return page


# Resolves every field in one round trip.
#
# Label precedence is the load-bearing part. On an Ashby form a custom question
# is named by an opaque UUID and its ONLY human-readable identity is the
# `<label for>`; the placeholder is generic filler ("Type here...",
# "1-415-555-1234...") that describes nothing. Reading the placeholder first --
# as this once did -- therefore threw away the real label and left an ordinary
# phone box unmappable, which forces the whole form to manual review.
#
# Order: label[for] -> aria-labelledby -> wrapping <label> -> aria-label ->
# placeholder -> name -> id. Placeholder is demoted, not dropped: on a form
# with no labels at all it is the last readable thing there is.
_READ_FIELDS_JS = """
() => {
  const clean = (s) => (s || '').replace(/\\s+/g, ' ').trim();

  const labelFor = (el) => {
    const id = el.getAttribute('id');
    if (!id) return '';
    try {
      const l = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      return l ? clean(l.textContent) : '';
    } catch (e) { return ''; }
  };

  const labelledBy = (el) => {
    const ref = el.getAttribute('aria-labelledby');
    if (!ref) return '';
    return clean(ref.split(/\\s+/)
      .map((x) => { const n = document.getElementById(x); return n ? n.textContent : ''; })
      .join(' '));
  };

  const wrapping = (el) => {
    const l = el.closest('label');
    return l ? clean(l.textContent) : '';
  };

  return Array.from(document.querySelectorAll('input, textarea, select'))
    .map((el) => {
      const name = el.getAttribute('name') || '';
      const id = el.getAttribute('id') || '';
      const type = el.getAttribute('type') || el.tagName.toLowerCase();
      const aria = el.getAttribute('aria-label') || '';
      const placeholder = el.getAttribute('placeholder') || '';
      const label = labelFor(el) || labelledBy(el) || wrapping(el)
                 || clean(aria) || clean(placeholder) || name || id;
      return {
        name, id, type, aria, label,
        required: el.hasAttribute('required') || el.getAttribute('aria-required') === 'true',
      };
    })
    .filter((f) => (f.name || f.id) && !['hidden', 'submit', 'button'].includes(f.type));
}
"""


async def read_fields(page) -> list[Field]:
    """Every fillable field on the form, with the best label the page offers.

    A field is kept when it carries EITHER a `name` or an `id`. Requiring
    `name` (as this once did) silently discarded modern Greenhouse forms
    wholesale: they are React-rendered and put identity in `id`/`aria-label`,
    so a live PhonePe posting exposed 2 of 50 fields and the agent filled
    nothing. `Field.key` decides which of the two is the identity.

    `required` reads aria-required as well as the attribute: React forms
    overwhelmingly use the former (26 vs 12 on a live PhonePe posting), and a
    required field the reader cannot see never reaches `unmapped`, which is the
    gate that forces manual review.
    """
    return [
        Field(
            name=f["name"],
            label=f["label"],
            id=f["id"],
            aria=f["aria"],
            kind=f["type"],
            required=f["required"],
        )
        for f in await page.evaluate(_READ_FIELDS_JS)
    ]


async def fill_form(page, values: dict, resume_path) -> None:
    """Fill each mapped value. Keys are `Field.key`, i.e. a `name` when the
    form had one and an `id` otherwise, so both are resolved here. Attribute
    selectors are used rather than `#id` so ids that are not valid CSS
    identifiers (leading digits, colons) still match without escaping.
    """
    for key, value in values.items():
        loc = page.locator(f"[name={key!r}]")
        if not await loc.count():
            loc = page.locator(f"[id={key!r}]")
        if await loc.count():
            await loc.first.fill(str(value))
    if resume_path:
        up = page.locator("input[type=file]")
        if await up.count():
            await up.first.set_input_files(resume_path)


async def submit_form(page) -> None:
    await page.locator("button[type=submit], input[type=submit]").first.click()


async def screenshot(page, path: str) -> None:
    await page.screenshot(path=path, full_page=True)
