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


async def fill_form(page, values: dict, resume_path, location: str | None = None) -> None:
    """Fill each mapped value. Keys are `Field.key`, i.e. a `name` when the
    form had one and an `id` otherwise, so both are resolved here. Attribute
    selectors are used rather than `#id` so ids that are not valid CSS
    identifiers (leading digits, colons) still match without escaping.

    `location` fills a type-ahead, which the key-based mapping above cannot
    reach: see `_fill_location_combobox`.
    """
    for key, value in values.items():
        loc = page.locator(f"[name={key!r}]")
        if not await loc.count():
            loc = page.locator(f"[id={key!r}]")
        if await loc.count():
            await loc.first.fill(str(value))
    if resume_path:
        index = await _resume_input_index(page)
        if index is not None:
            await page.locator("input[type=file]").nth(index).set_input_files(resume_path)
    if location:
        await _fill_location_combobox(page, location)


# Describes each file input by whatever text identifies it, in DOM order, so
# the resume can be sent to the right one. Same label precedence as
# _READ_FIELDS_JS: the visible label is the only thing that distinguishes a
# resume slot from a cover-letter slot on a form whose ids are UUIDs.
_FILE_INPUTS_JS = """
() => {
  const clean = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  return Array.from(document.querySelectorAll('input[type=file]')).map((el) => {
    const id = el.getAttribute('id') || '';
    let label = '';
    if (id) {
      try {
        const l = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        label = l ? clean(l.textContent) : '';
      } catch (e) { label = ''; }
    }
    if (!label) {
      const ref = el.getAttribute('aria-labelledby');
      if (ref) {
        label = clean(ref.split(/\\s+/)
          .map((x) => { const n = document.getElementById(x); return n ? n.textContent : ''; })
          .join(' '));
      }
    }
    if (!label) {
      const wrap = el.closest('label');
      label = wrap ? clean(wrap.textContent) : '';
    }
    return `${label} ${el.getAttribute('name') || ''} ${id} ${el.getAttribute('aria-label') || ''}`.toLowerCase();
  });
}
"""

# A file input that IS the resume slot.
_RESUME_WORDS = ("resume", "resumé", "cv", "curriculum")

# A file input that takes some other document. An Ashby posting puts its own
# "autofill from resume" helper above the form and a "Additional Attachments"
# slot below it, so "contains the word resume" is not enough on its own.
_NOT_RESUME_WORDS = (
    "cover", "additional", "attachment", "portfolio", "transcript",
    "autofill", "auto-fill", "photo", "certificate", "sample",
)


async def _resume_input_index(page) -> int | None:
    """Which file input should receive the resume, or None to upload nothing.

    Taking the first file input on the page -- as this once did -- fed Ashby's
    "autofill from resume" helper, which sits ABOVE the form. The resume was
    uploaded on every run, into the wrong control, while the required Resume
    field stayed empty and forced the application to manual review.

    None is a real answer. When several inputs are present and none of them
    identifies itself as the resume slot, attaching the CV to a cover-letter or
    portfolio field is worse than leaving it: a blank required field forces a
    human to look, a wrong attachment gets submitted.
    """
    try:
        descriptions = await page.evaluate(_FILE_INPUTS_JS)
    except Exception:
        return None

    if not descriptions:
        return None

    for i, text in enumerate(descriptions):
        if any(w in text for w in _NOT_RESUME_WORDS):
            continue
        if any(w in text for w in _RESUME_WORDS):
            return i

    # Exactly one input and nothing claiming to be something else: there is
    # nothing to confuse it with, so it is the resume field.
    if len(descriptions) == 1 and not any(w in descriptions[0] for w in _NOT_RESUME_WORDS):
        return 0

    return None


# The text around each ARIA combobox, in DOM order. A type-ahead on these
# forms carries no name, no id and no <label for>; the nearest ancestor that
# holds a short block of text is the only thing that says what it is asking.
_COMBOBOX_CONTEXT_JS = """
() => Array.from(document.querySelectorAll('input[role=combobox], input[aria-autocomplete=list]'))
  .map((el) => {
    let node = el.parentElement, text = '';
    for (let i = 0; i < 5 && node; i++, node = node.parentElement) {
      const t = (node.innerText || '').replace(/\\s+/g, ' ').trim();
      if (t && t.length < 300) { text = t; break; }
    }
    return `${text} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('placeholder') || ''}`.toLowerCase();
  })
"""

_LOCATION_WORDS = ("location", "where are you based", "city of residence",
                   "country of residence", "where do you live")

OPTION_WAIT_MS = 4000


async def _fill_location_combobox(page, location: str) -> None:
    """Type into the location type-ahead and choose the matching option.

    A type-ahead holds no value until an option is chosen, so `fill()` alone
    leaves the field empty -- which is what happened on every application: a
    required field silently blank. The key-based mapping cannot reach it at
    all, because the input carries no name and no id.

    Choosing nothing is a real answer. An option is only clicked when it
    plainly corresponds to the candidate's stated location; taking whatever
    happened to be listed first would put a wrong address on a real
    application, and a blank required field forces manual review instead.
    """
    try:
        contexts = await page.evaluate(_COMBOBOX_CONTEXT_JS)
    except Exception:
        return

    index = next((i for i, text in enumerate(contexts)
                  if any(w in text for w in _LOCATION_WORDS)), None)
    if index is None:
        return

    # The city alone, so the board's own spelling of the region can differ.
    city = location.split(",")[0].strip()
    if not city:
        return

    combo = page.locator("input[role=combobox], input[aria-autocomplete=list]").nth(index)
    try:
        await combo.click()
        await combo.type(city, delay=40)

        choice = None
        try:
            await page.wait_for_selector("[role=option]", timeout=OPTION_WAIT_MS, state="attached")
            choice = _best_option(await page.locator("[role=option]").all_inner_texts(), location, city)
        except Exception:
            # No list ever appeared. Falls through to the clear below: the
            # typed text must not be left behind.
            choice = None

        if choice is None:
            # Clear the half-typed text so the field reads as untouched rather
            # than as a value the candidate chose. A partial city name sitting
            # in a required box is worse than an empty one -- it can be
            # submitted, and it looks deliberate.
            await combo.fill("")
            return

        await page.locator("[role=option]").nth(choice).click()
    except Exception:
        # A type-ahead that does not behave costs this one field, never the run.
        try:
            await combo.fill("")
        except Exception:
            pass


def _best_option(options: list[str], location: str, city: str) -> int | None:
    """The option that corresponds to `location`, or None to choose nothing."""
    normalized = [o.replace("\n", " ").strip().lower() for o in options]
    wanted = location.strip().lower()

    for i, text in enumerate(normalized):
        if text == wanted:
            return i

    # No exact match: accept one only if it is unambiguous. Two options both
    # naming the city (a "Bengaluru" and a "Bengaluru Rural") is exactly the
    # case where guessing puts the wrong address on an application.
    matches = [i for i, text in enumerate(normalized) if text.startswith(city.lower())]
    return matches[0] if len(matches) == 1 else None


async def submit_form(page) -> None:
    await page.locator("button[type=submit], input[type=submit]").first.click()


async def screenshot(page, path: str) -> None:
    await page.screenshot(path=path, full_page=True)
