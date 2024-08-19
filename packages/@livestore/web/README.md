# @livestore/web

## Current limitations

- Note that until [this Vite bug](https://github.com/vitejs/vite/issues/8427) is fixed you need to ...
  - Explicitly add `@livestore/wa-sqlite` to your `package.json`
  - Add the following to your `vite.config.js`
	  ```
		  optimizeDeps: {
				exclude: ['@livestore/wa-sqlite'],
			},
		```