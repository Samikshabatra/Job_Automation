"""Where a posting's application FORM lives, which is not always where the
posting lives.

The discovery side stores the URL a human would be sent to. On some boards
that page is a description with an "Apply for this job" button, and the form
itself is a separate route. Opening the stored URL and reading its fields then
finds nothing, and the agent concludes the posting has no form -- so a live
Snowflake posting with 17 fields was being routed to manual review as though
it were empty.
"""


def application_url(url: str, ats_platform: str | None) -> str:
    """The URL that actually renders the application form.

    Returns `url` unchanged for boards whose posting URL already is the form,
    and for anything unrecognised: guessing a route that does not exist would
    turn a working posting into a 404.
    """
    if not url:
        return url

    if ats_platform == "ashby":
        # jobs.ashbyhq.com/{org}/{id} is the description; the form is at
        # /{org}/{id}/application. Verified against a live posting: the bare
        # URL exposes 0 fields, the /application route exposes 17.
        trimmed = url.rstrip("/")
        if trimmed.endswith("/application"):
            return trimmed
        # Leave query strings and fragments alone -- Ashby uses ?utm_source=
        # on shared links and appending after them produces a dead route.
        if "?" in trimmed or "#" in trimmed:
            return trimmed
        return f"{trimmed}/application"

    return url
