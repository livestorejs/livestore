{
  lib,
  stdenv,
  fetchfossil,
  openssl,
}:

stdenv.mkDerivation {
  pname = "althttpd";
  version = "unstable-2022-08-12";

  src = fetchfossil {
    url = "https://sqlite.org/althttpd/";
    rev = "29088d6f040b7e67";
    sha256 = "sha256-mjIvVHR3dlvBWKzRtSSB7Voe+VJUmuQXQBJW1U6woas=";
    # sha256 = lib.fakeSha256;
  };

  buildInputs = [ openssl ];

  makeFlags = [ "CC:=$(CC)" ];

  installPhase = ''
    install -Dm755 -t $out/bin althttpd
  '';

  meta = with lib; {
    description = "The Althttpd webserver";
    homepage = "https://sqlite.org/althttpd/";
    license = licenses.publicDomain;
    maintainers = with maintainers; [ siraben ];
    platforms = platforms.all;
  };
}
