# @livestore/webmesh

Webmesh is a library for connecting multiple nodes (windows/tabs, workers, threads, ...) in a network-like topology. It helps to establish end-to-end communication channels between nodes either by proxying messages via hop nodes or by establishing an end-to-end `MessageChannel` with support for transferable objects (e.g. `Uint8Array`) when possible.

It's used in LiveStore as the foundation for the LiveStore devtools protocol communication.