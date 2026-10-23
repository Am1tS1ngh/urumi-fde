"""Create a local-only CA and signed server certificate; never install OS trust."""
from datetime import datetime, timedelta, timezone
from ipaddress import ip_address
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa, padding
from cryptography.x509.oid import NameOID, ExtendedKeyUsageOID

directory = Path(__file__).resolve().parent.parent / '.local' / 'tls'
directory.mkdir(parents=True, exist_ok=True)
paths = [directory / name for name in ('ca.crt', 'server.crt', 'server.key')]
now = datetime.now(timezone.utc)

if any(path.exists() for path in paths):
    if not all(path.exists() for path in paths):
        raise SystemExit('Partial TLS files exist. Inspect them before regenerating; no files overwritten.')
    ca = x509.load_pem_x509_certificate(paths[0].read_bytes())
    server = x509.load_pem_x509_certificate(paths[1].read_bytes())
    key = serialization.load_pem_private_key(paths[2].read_bytes(), password=None)
    ca.public_key().verify(server.signature, server.tbs_certificate_bytes, padding.PKCS1v15(), server.signature_hash_algorithm)
    if key.public_key().public_numbers() != server.public_key().public_numbers():
        raise SystemExit('TLS private key does not match the certificate.')
    names = server.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
    if not {'localhost', 'store.localhost'}.issubset(names.get_values_for_type(x509.DNSName)):
        raise SystemExit('TLS certificate lacks the expected local hostnames.')
    if any(cert.not_valid_after_utc <= now + timedelta(days=1) or cert.not_valid_before_utc > now for cert in (ca, server)):
        raise SystemExit('TLS certificates expired or not valid yet; renew explicitly.')
    print('Reusing valid local TLS certificates.')
else:
    ca_key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
    ca_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'Urumi local development CA')])
    ca = (x509.CertificateBuilder().subject_name(ca_name).issuer_name(ca_name)
          .public_key(ca_key.public_key()).serial_number(x509.random_serial_number())
          .not_valid_before(now - timedelta(minutes=5)).not_valid_after(now + timedelta(days=365))
          .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
          .add_extension(x509.KeyUsage(digital_signature=True, content_commitment=False,
              key_encipherment=False, data_encipherment=False, key_agreement=False,
              key_cert_sign=True, crl_sign=True, encipher_only=None, decipher_only=None), critical=True)
          .sign(ca_key, hashes.SHA256()))
    server_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    server_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'localhost')])
    server = (x509.CertificateBuilder().subject_name(server_name).issuer_name(ca.subject)
              .public_key(server_key.public_key()).serial_number(x509.random_serial_number())
              .not_valid_before(now - timedelta(minutes=5)).not_valid_after(now + timedelta(days=90))
              .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
              .add_extension(x509.SubjectAlternativeName([
                  x509.DNSName('localhost'), x509.DNSName('store.localhost'),
                  x509.IPAddress(ip_address('127.0.0.1'))]), critical=False)
              .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
              .add_extension(x509.KeyUsage(digital_signature=True, content_commitment=False,
                  key_encipherment=True, data_encipherment=False, key_agreement=False,
                  key_cert_sign=False, crl_sign=False, encipher_only=None, decipher_only=None), critical=True)
              .sign(ca_key, hashes.SHA256()))
    paths[0].write_bytes(ca.public_bytes(serialization.Encoding.PEM))
    paths[1].write_bytes(server.public_bytes(serialization.Encoding.PEM))
    paths[2].write_bytes(server_key.private_bytes(serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    # The CA signing key is intentionally not persisted.
    print('Created ignored local TLS files. No system trust settings were changed.')
