import re

_CAPTCHA = re.compile(r"g-recaptcha|recaptcha/api|hcaptcha\.com|data-sitekey|cf-challenge", re.I)
_CONFIRM = re.compile(r"thank you for applying|application (has been )?received|successfully submitted|we('|’)ve received your application", re.I)


def has_captcha(html: str) -> bool:
    return bool(_CAPTCHA.search(html or ""))


def is_confirmation(html: str) -> bool:
    return bool(_CONFIRM.search(html or ""))
