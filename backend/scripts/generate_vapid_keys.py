"""Print a fresh VAPID key pair for Web Push, ready to paste into .env.

    docker compose exec backend python scripts/generate_vapid_keys.py
    # or, anywhere with `cryptography` installed:
    python backend/scripts/generate_vapid_keys.py

Both values are base64url without padding: the public key is the uncompressed
P-256 point (what browsers take as applicationServerKey), the private key the
raw 32-byte scalar (what pywebpush accepts). Same format as
`npx web-push generate-vapid-keys`. Generate once: rotating the pair
invalidates every existing browser subscription.
"""

import base64

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def main() -> None:
    key = ec.generate_private_key(ec.SECP256R1())
    public = key.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    private = key.private_numbers().private_value.to_bytes(32, "big")
    print(f"VAPID_PUBLIC_KEY={_b64url(public)}")
    print(f"VAPID_PRIVATE_KEY={_b64url(private)}")
    print("VAPID_SUBJECT=mailto:hola@andreipop.org")


if __name__ == "__main__":
    main()
