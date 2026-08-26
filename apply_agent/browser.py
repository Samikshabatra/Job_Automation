# apply_agent/browser.py
from apply_agent.fieldmap import Field


async def open_form(context, url):
    page = await context.new_page()
    await page.goto(url, wait_until="domcontentloaded")
    return page


async def read_fields(page) -> list[Field]:
    """Every fillable field on the form.

    A field is kept when it carries EITHER a `name` or an `id`. Requiring
    `name` (as this once did) silently discarded modern Greenhouse forms
    wholesale: they are React-rendered and put identity in `id`/`aria-label`,
    so a live PhonePe posting exposed 2 of 50 fields and the agent filled
    nothing. `Field.key` decides which of the two is the identity.
    """
    handles = await page.query_selector_all("input, textarea, select")
    fields: list[Field] = []
    for h in handles:
        name = await h.get_attribute("name") or ""
        element_id = await h.get_attribute("id") or ""
        if not (name or element_id):
            continue
        if (await h.get_attribute("type")) in ("hidden", "submit", "button"):
            continue
        aria = await h.get_attribute("aria-label") or ""
        placeholder = await h.get_attribute("placeholder") or ""
        fields.append(Field(
            name=name,
            # aria-label first: on an id-only form it is the only human-readable
            # description, and falling back to the raw key last keeps _hay from
            # ever being empty.
            label=placeholder or aria or name or element_id,
            id=element_id,
            aria=aria,
            kind=(await h.get_attribute("type")) or (await h.evaluate("e => e.tagName.toLowerCase()")),
            # aria-required, not just the `required` attribute: React forms
            # overwhelmingly use the former (26 vs 12 on a live PhonePe
            # posting), and a required field the reader cannot see never
            # reaches `unmapped`, which is a gate that forces manual review.
            required=(await h.get_attribute("required")) is not None
            or (await h.get_attribute("aria-required")) == "true",
        ))
    return fields


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
