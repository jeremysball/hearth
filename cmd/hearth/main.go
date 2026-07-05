// Command hearth runs the Hearth server, or handles CLI subcommands (e.g.
// `hearth invite`) that operate on the database directly.
package main

import (
	"os"

	"github.com/jeremysball/hearth/server"
)

func main() {
	if server.RunCLI(os.Args[1:]) {
		return
	}
	server.Run()
}
