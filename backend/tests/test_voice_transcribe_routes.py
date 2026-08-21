"""Voice STT router wiring."""
import voice_transcribe_routes


def test_voice_transcribe_router_wired():
    paths = {getattr(r, "path", None) for r in voice_transcribe_routes.router.routes}
    assert "/api/voice/transcribe" in paths
