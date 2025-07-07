{ lib, stdenv, pkgs }:

pkgs.writeShellApplication {
  name = "find-free-port";

  text = ''
    #!/bin/bash

    # Set the lower and upper bounds for the safe port range
    lower=49152
    upper=65535

    # Loop until we find an available port in the safe range
    while true; do
        # Generate a random port between the lower and upper bounds
        port=$(shuf -i $lower-$upper -n 1)
        # Check if the port is available
        if ! lsof -i :"$port" > /dev/null; then
            # If the port is available, print it and exit
            echo "$port"
            exit 0
        fi
    done
  '';

  runtimeInputs = [
    pkgs.bash
  ] ++ lib.optionals stdenv.isLinux [
    pkgs.unixtools.netstat # needed for netstat
    pkgs.lsof
  ];

}

