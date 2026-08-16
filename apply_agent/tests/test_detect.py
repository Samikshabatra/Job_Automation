from apply_agent.detect import has_captcha, is_confirmation


def test_detects_recaptcha_and_hcaptcha():
    assert has_captcha('<div class="g-recaptcha" data-sitekey="x"></div>') is True
    assert has_captcha('<iframe src="https://hcaptcha.com/..."></iframe>') is True
    assert has_captcha("<form><input name=email></form>") is False


def test_detects_confirmation_page():
    assert is_confirmation("<h1>Thank you for applying</h1>") is True
    assert is_confirmation("<p>Your application has been received.</p>") is True
    assert is_confirmation("<form>Apply now</form>") is False
