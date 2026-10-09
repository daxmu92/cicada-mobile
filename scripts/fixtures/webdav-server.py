"""Real HTTPS WebDAV fixture; all settings and storage are test-owned."""
import json
import sys

from cheroot import wsgi
from cheroot.ssl.builtin import BuiltinSSLAdapter
from wsgidav.wsgidav_app import WsgiDAVApp

with open(sys.argv[1], encoding="utf-8") as source:
    config = json.load(source)
app = WsgiDAVApp({
    "provider_mapping": {"/": config["root"]},
    "http_authenticator": {"accept_basic": True, "accept_digest": False},
    "simple_dc": {"user_mapping": {"*": {
        config["username"]: {"password": config["password"]}
    }}},
    "verbose": 0,
    "logging": {"enable": False},
    "dir_browser": {"enable": False},
})
server = wsgi.Server(("127.0.0.1", config["port"]), app)
server.ssl_adapter = BuiltinSSLAdapter(config["cert"], config["key"])
server.start()
