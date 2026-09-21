"""Pinterest token encryption — alias over the shared integrations cipher."""

from app.integrations.crypto import IntegrationCryptoError as PinterestCryptoError
from app.integrations.crypto import decrypt_token, encrypt_token

__all__ = ["PinterestCryptoError", "decrypt_token", "encrypt_token"]
