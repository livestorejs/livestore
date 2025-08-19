## Notes

- Should support "concurrent" ws messages before full request is finished (i.e. different than RPC behaviour)
- Should support multiple concurrent/subsequent pull requests
- embrace Effect rpc for WS transport?
- how to model concurrency best with RPC

- subscription architecture
  - approaches
    - 1) poke to pull
    - 2) broadcast the push to all clients (let client buffer + deduplicate)
  - queue per subscription