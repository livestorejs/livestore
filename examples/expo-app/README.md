## Setup requirements

- Until Expo supports the bytecode SQLite flag out of the box, you have to use the dev build of the app (i.e. Expo Go is not yet supported).
- In particular you need to set "Other C Flags" to `-DSQLITE_ENABLE_BYTECODE_VTAB`

![](https://media.cleanshot.cloud/media/350/6VuLntWj3pIGHoyNBPs4wTGc29rQ5md7Lf3cgzSl.png?Expires=1709156746&Signature=abe5P8ui7uLtWDiGQHFZjcWDaxiPMEvhFOp2rXF3Wy-8gdP-Eb5GZZzLEl1SgEqPxZsSMDeL7V4ydRMd63AtLT-bUm5g3LIkZ5untZVz46s7OAsRRuUjqALSaBet~g13wayxWhjm37nrkGqIkXHbbiuhoZvej-Sd1TiZI2X0kRNeW~zYLv9G3x0OlJCAAdCTJKnrXCxj9K4SYWjItNErmbS1wKxcDsxTMKYg9~GbXqRZPzVdfS3x1-qvvrzSzlu~lvuWj2iZ58rH5W~0gv74T1fWlqbGQF5Oa3uNKkDp9Ug68H4pLUSOw2oAoexDWrX6hJLrAWB6w6YVjkX3VJAa3Q__&Key-Pair-Id=K269JMAT9ZF4GZ)