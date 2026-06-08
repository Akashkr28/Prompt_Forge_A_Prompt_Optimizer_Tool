"""FastAPI backend that exposes the optimizer engine over HTTP for the Next.js frontend.

Thin layer only: every request delegates to the existing ``optimizer`` package
(config/pipeline/storage) so the API, the CLI, and the legacy Streamlit
dashboard all drive the exact same orchestration and persistence code — no
behavior drift between front ends.
"""
