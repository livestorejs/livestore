{lib, ...}: {
  cli = {
    # Disable the process-compose HTTP server
    options.no-server = lib.mkDefault true;
  };
}
