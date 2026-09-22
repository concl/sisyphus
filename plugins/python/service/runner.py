"""Own the socket before announcing its port: no port reservation race."""
import socket
import sys
import uvicorn

if __name__ == "__main__":
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        listener.listen(128)
        print(f"SISYPHUS_PORT={listener.getsockname()[1]}", flush=True)
        config = uvicorn.Config(sys.argv[1], host="127.0.0.1", log_level="info")
        uvicorn.Server(config).run(sockets=[listener])
