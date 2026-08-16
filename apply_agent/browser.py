# apply_agent/browser.py
from apply_agent.fieldmap import Field


async def open_form(context, url):
    page = await context.new_page()
    await page.goto(url, wait_until="domcontentloaded")
    return page


async def read_fields(page) -> list[Field]:
    handles = await page.query_selector_all("input, textarea, select")
    fields: list[Field] = []
    for h in handles:
        name = await h.get_attribute("name") or ""
        if not name or (await h.get_attribute("type")) in ("hidden", "submit", "button"):
            continue
        fields.append(Field(
            name=name,
            label=(await h.get_attribute("placeholder")) or (await h.get_attribute("aria-label")) or name,
            id=await h.get_attribute("id") or "",
            aria=await h.get_attribute("aria-label") or "",
            kind=(await h.get_attribute("type")) or (await h.evaluate("e => e.tagName.toLowerCase()")),
            required=(await h.get_attribute("required")) is not None,
        ))
    return fields


async def fill_form(page, values: dict, resume_path) -> None:
    for name, value in values.items():
        loc = page.locator(f"[name={name!r}]")
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
