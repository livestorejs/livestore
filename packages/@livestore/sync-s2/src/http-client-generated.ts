// Generated via forked version of https://github.com/tim-smart/openapi-gen
// in order to workaround https://github.com/tim-smart/openapi-gen/issues/75
// Further adjustments:
// 1) Use Effect imports from @livestore/utils/effect
// 2) Fixed CreateOrReconfigureBasinRequest to not be self-referencing
import {
  Data,
  Effect,
  type HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
  type ParseResult,
  Schema as S,
} from '@livestore/utils/effect'

export class ListAccessTokensParams extends S.Struct({
  prefix: S.optionalWith(S.String, { nullable: true, default: () => '' as const }),
  start_after: S.optionalWith(S.String, { nullable: true, default: () => '' as const }),
  limit: S.optionalWith(S.Int.pipe(S.greaterThanOrEqualTo(0), S.lessThanOrEqualTo(1000)), {
    nullable: true,
    default: () => 1000 as const,
  }),
}) {}

export class ResourceSet extends S.Union(
  /**
   * Match only the resource with this exact name.
   * Use an empty string to match no resources.
   */
  S.Struct({
    /**
     * Match only the resource with this exact name.
     * Use an empty string to match no resources.
     */
    exact: S.String,
  }),
  /**
   * Match all resources that start with this prefix.
   * Use an empty string to match all resource.
   */
  S.Struct({
    /**
     * Match all resources that start with this prefix.
     * Use an empty string to match all resource.
     */
    prefix: S.String,
  }),
) {}

export class ReadWritePermissions extends S.Class<ReadWritePermissions>('ReadWritePermissions')({
  /**
   * Read permission.
   */
  read: S.optionalWith(S.Boolean, { nullable: true, default: () => false as const }),
  /**
   * Write permission.
   */
  write: S.optionalWith(S.Boolean, { nullable: true, default: () => false as const }),
}) {}

export class PermittedOperationGroups extends S.Class<PermittedOperationGroups>('PermittedOperationGroups')({
  account: S.optionalWith(ReadWritePermissions, { nullable: true }),
  basin: S.optionalWith(ReadWritePermissions, { nullable: true }),
  stream: S.optionalWith(ReadWritePermissions, { nullable: true }),
}) {}

export class Operation extends S.Literal(
  'list-basins',
  'create-basin',
  'delete-basin',
  'reconfigure-basin',
  'get-basin-config',
  'issue-access-token',
  'revoke-access-token',
  'list-access-tokens',
  'list-streams',
  'create-stream',
  'delete-stream',
  'get-stream-config',
  'reconfigure-stream',
  'check-tail',
  'append',
  'read',
  'trim',
  'fence',
  'account-metrics',
  'basin-metrics',
  'stream-metrics',
) {}

export class AccessTokenScope extends S.Class<AccessTokenScope>('AccessTokenScope')({
  access_tokens: S.optionalWith(ResourceSet, { nullable: true }),
  basins: S.optionalWith(ResourceSet, { nullable: true }),
  op_groups: S.optionalWith(PermittedOperationGroups, { nullable: true }),
  /**
   * Operations allowed for the token.
   * A union of allowed operations and groups is used as an effective set of allowed operations.
   */
  ops: S.optionalWith(S.Array(Operation), { nullable: true }),
  streams: S.optionalWith(ResourceSet, { nullable: true }),
}) {}

export class AccessTokenInfo extends S.Class<AccessTokenInfo>('AccessTokenInfo')({
  /**
   * Namespace streams based on the configured stream-level scope, which must be a prefix.
   * Stream name arguments will be automatically prefixed, and the prefix will be stripped when listing streams.
   */
  auto_prefix_streams: S.optionalWith(S.Boolean, { nullable: true, default: () => false as const }),
  /**
   * Expiration time in ISO 8601 format.
   * If not set, the expiration will be set to that of the requestor's token.
   */
  expires_at: S.optionalWith(S.String, { nullable: true }),
  /**
   * Access token ID.
   * It must be unique to the account and between 1 and 96 bytes in length.
   */
  id: S.String,
  /**
   * Access token scope.
   */
  scope: AccessTokenScope,
}) {}

export class ListAccessTokensResponse extends S.Class<ListAccessTokensResponse>('ListAccessTokensResponse')({
  /**
   * Matching access tokens.
   */
  access_tokens: S.Array(AccessTokenInfo).pipe(S.maxItems(1000)),
  /**
   * Indicates that there are more access tokens that match the criteria.
   */
  has_more: S.Boolean,
}) {}

export class ErrorResponse extends S.Class<ErrorResponse>('ErrorResponse')({
  code: S.optionalWith(S.String, { nullable: true }),
  message: S.String,
}) {}

export class IssueAccessTokenResponse extends S.Class<IssueAccessTokenResponse>('IssueAccessTokenResponse')({
  /**
   * Created access token.
   */
  access_token: S.String,
}) {}

export class ListBasinsParams extends S.Struct({
  prefix: S.optionalWith(S.String, { nullable: true, default: () => '' as const }),
  start_after: S.optionalWith(S.String, { nullable: true, default: () => '' as const }),
  limit: S.optionalWith(S.Int.pipe(S.greaterThanOrEqualTo(0), S.lessThanOrEqualTo(1000)), {
    nullable: true,
    default: () => 1000 as const,
  }),
}) {}

export class BasinScope extends S.Literal('aws:us-east-1') {}

export class BasinState extends S.Literal('active', 'creating', 'deleting') {}

export class BasinInfo extends S.Class<BasinInfo>('BasinInfo')({
  /**
   * Basin name.
   */
  name: S.String,
  /**
   * Basin scope.
   */
  scope: BasinScope,
  /**
   * Basin state.
   */
  state: BasinState,
}) {}

export class ListBasinsResponse extends S.Class<ListBasinsResponse>('ListBasinsResponse')({
  /**
   * Matching basins.
   */
  basins: S.Array(BasinInfo).pipe(S.maxItems(1000)),
  /**
   * Indicates that there are more basins that match the criteria.
   */
  has_more: S.Boolean,
}) {}

export class DeleteOnEmptyConfig extends S.Class<DeleteOnEmptyConfig>('DeleteOnEmptyConfig')({
  /**
   * Minimum age in seconds before an empty stream can be deleted.
   * Set to 0 (default) to disable delete-on-empty (don't delete automatically).
   */
  min_age_secs: S.optionalWith(S.Int.pipe(S.greaterThanOrEqualTo(0)), { nullable: true }),
}) {}

export class InfiniteRetention extends S.Record({ key: S.String, value: S.Unknown }) {}

export class RetentionPolicy extends S.Union(
  /**
   * Age in seconds for automatic trimming of records older than this threshold.
   * This must be set to a value greater than 0 seconds.
   * (While S2 is in public preview, this is capped at 28 days. Let us know if you'd like the cap removed.)
   */
  S.Struct({
    /**
     * Age in seconds for automatic trimming of records older than this threshold.
     * This must be set to a value greater than 0 seconds.
     * (While S2 is in public preview, this is capped at 28 days. Let us know if you'd like the cap removed.)
     */
    age: S.Int.pipe(S.greaterThanOrEqualTo(0)),
  }),
  /**
   * Retain records unless explicitly trimmed.
   */
  S.Struct({
    /**
     * Retain records unless explicitly trimmed.
     */
    infinite: InfiniteRetention,
  }),
) {}

export class StorageClass extends S.Literal('standard', 'express') {}

export class TimestampingMode extends S.Literal('client-prefer', 'client-require', 'arrival') {}

export class TimestampingConfig extends S.Class<TimestampingConfig>('TimestampingConfig')({
  mode: S.optionalWith(TimestampingMode, { nullable: true }),
  /**
   * Allow client-specified timestamps to exceed the arrival time.
   * If this is `false` or not set, client timestamps will be capped at the arrival time.
   */
  uncapped: S.optionalWith(S.Boolean, { nullable: true }),
}) {}

export class StreamConfig extends S.Class<StreamConfig>('StreamConfig')({
  delete_on_empty: S.optionalWith(DeleteOnEmptyConfig, { nullable: true }),
  retention_policy: S.optionalWith(RetentionPolicy, { nullable: true }),
  storage_class: S.optionalWith(StorageClass, { nullable: true }),
  timestamping: S.optionalWith(TimestampingConfig, { nullable: true }),
}) {}

export class BasinConfig extends S.Class<BasinConfig>('BasinConfig')({
  /**
   * Create stream on append if it doesn't exist, using the default stream configuration.
   */
  create_stream_on_append: S.optionalWith(S.Boolean, { nullable: true }),
  /**
   * Create stream on read if it doesn't exist, using the default stream configuration.
   */
  create_stream_on_read: S.optionalWith(S.Boolean, { nullable: true }),
  default_stream_config: S.optionalWith(StreamConfig, { nullable: true }),
}) {}

export class CreateBasinRequest extends S.Class<CreateBasinRequest>('CreateBasinRequest')({
  /**
   * Basin name which must be globally unique.
   * It can be between 8 and 48 characters in length, and comprise lowercase letters, numbers and hyphens.
   * It cannot begin or end with a hyphen.
   */
  basin: S.String,
  config: S.optionalWith(BasinConfig, { nullable: true }),
  /**
   * Basin scope.
   */
  scope: S.optionalWith(BasinScope, { nullable: true, default: () => 'aws:us-east-1' as const }),
}) {}

export class CreateOrReconfigureBasinParams extends S.Struct({
  's2-request-token': S.optionalWith(S.String, { nullable: true }),
}) {}

export class CreateOrReconfigureBasinRequest extends S.Union(S.Null) {}
// export class CreateOrReconfigureBasinRequest extends S.Union(S.Null, CreateOrReconfigureBasinRequest) {}

export class DeleteOnEmptyReconfiguration extends S.Class<DeleteOnEmptyReconfiguration>('DeleteOnEmptyReconfiguration')(
  {
    /**
     * Minimum age in seconds before an empty stream can be deleted.
     * Set to 0 to disable delete-on-empty (don't delete automatically).
     */
    min_age_secs: S.optionalWith(S.Int.pipe(S.greaterThanOrEqualTo(0)), { nullable: true }),
  },
) {}

export class TimestampingReconfiguration extends S.Class<TimestampingReconfiguration>('TimestampingReconfiguration')({
  mode: S.optionalWith(TimestampingMode, { nullable: true }),
  /**
   * Allow client-specified timestamps to exceed the arrival time.
   */
  uncapped: S.optionalWith(S.Boolean, { nullable: true }),
}) {}

export class StreamReconfiguration extends S.Class<StreamReconfiguration>('StreamReconfiguration')({
  delete_on_empty: S.optionalWith(DeleteOnEmptyReconfiguration, { nullable: true }),
  retention_policy: S.optionalWith(RetentionPolicy, { nullable: true }),
  storage_class: S.optionalWith(StorageClass, { nullable: true }),
  timestamping: S.optionalWith(TimestampingReconfiguration, { nullable: true }),
}) {}

export class BasinReconfiguration extends S.Class<BasinReconfiguration>('BasinReconfiguration')({
  /**
   * Create a stream on append.
   */
  create_stream_on_append: S.optionalWith(S.Boolean, { nullable: true }),
  /**
   * Create a stream on read.
   */
  create_stream_on_read: S.optionalWith(S.Boolean, { nullable: true }),
  default_stream_config: S.optionalWith(StreamReconfiguration, { nullable: true }),
}) {}

export class AccountMetricSet extends S.Literal('active-basins', 'account-ops') {}

export class TimeseriesInterval extends S.Literal('minute', 'hour', 'day') {}

export class AccountMetricsParams extends S.Struct({
  set: AccountMetricSet,
  start: S.optionalWith(S.Int.pipe(S.greaterThanOrEqualTo(0)), { nullable: true }),
  end: S.optionalWith(S.Int.pipe(S.greaterThanOrEqualTo(0)), { nullable: true }),
  interval: S.optionalWith(TimeseriesInterval, { nullable: true }),
}) {}

export class MetricUnit extends S.Literal('bytes', 'operations') {}

export class Scalar extends S.Class<Scalar>('Scalar')({
  /**
   * Metric name.
   */
  name: S.String,
  /**
   * Unit of the metric.
   */
  unit: MetricUnit,
  /**
   * Metric value.
   */
  value: S.Number,
}) {}

export class Accumulation extends S.Class<Accumulation>('Accumulation')({
  /**
   * The duration of bucket for the accumulation.
   */
  bucket_length: TimeseriesInterval,
  /**
   * Timeseries name.
   */
  name: S.String,
  /**
   * Unit of the metric.
   */
  unit: MetricUnit,
}) {}

export class Gauge extends S.Class<Gauge>('Gauge')({
  /**
   * Timeseries name.
   */
  name: S.String,
  /**
   * Unit of the metric.
   */
  unit: MetricUnit,
}) {}

export class Label extends S.Class<Label>('Label')({
  /**
   * Label name.
   */
  name: S.String,
  /**
   * Label values.
   */
  values: S.Array(S.String),
}) {}

export class Metric extends S.Union(
  /**
   * Single named value.
   */
  S.Struct({
    /**
     * Single named value.
     */
    scalar: Scalar,
  }),
  /**
   * Named series of `(timestamp, value)` points representing an accumulation over a specified
   * bucket.
   */
  S.Struct({
    /**
     * Named series of `(timestamp, value)` points representing an accumulation over a specified
     * bucket.
     */
    accumulation: Accumulation,
  }),
  /**
   * Named series of `(timestamp, value)` points each representing an instantaneous value.
   */
  S.Struct({
    /**
     * Named series of `(timestamp, value)` points each representing an instantaneous value.
     */
    gauge: Gauge,
  }),
  /**
   * Set of string labels.
   */
  S.Struct({
    /**
     * Set of string labels.
     */
    label: Label,
  }),
) {}

export class MetricSetResponse extends S.Class<MetricSetResponse>('MetricSetResponse')({
  /**
   * Metrics comprising the set.
   */
  values: S.Array(Metric),
}) {}

export class BasinMetricSet extends S.Literal(
  'storage',
  'append-ops',
  'read-ops',
  'read-throughput',
  'append-throughput',
  'basin-ops',
) {}

export class BasinMetricsParams extends S.Struct({
  set: BasinMetricSet,
  start: S.optionalWith(S.Int.pipe(S.greaterThanOrEqualTo(0)), { nullable: true }),
  end: S.optionalWith(S.Int.pipe(S.greaterThanOrEqualTo(0)), { nullable: true }),
  interval: S.optionalWith(TimeseriesInterval, { nullable: true }),
}) {}

export class StreamMetricSet extends S.Literal('storage') {}

export class StreamMetricsParams extends S.Struct({
  set: StreamMetricSet,
  start: S.optionalWith(S.Int.pipe(S.greaterThanOrEqualTo(0)), { nullable: true }),
  end: S.optionalWith(S.Int.pipe(S.greaterThanOrEqualTo(0)), { nullable: true }),
  interval: S.optionalWith(TimeseriesInterval, { nullable: true }),
}) {}

export class ListStreamsParams extends S.Struct({
  prefix: S.optionalWith(S.String, { nullable: true, default: () => '' as const }),
  start_after: S.optionalWith(S.String, { nullable: true, default: () => '' as const }),
  limit: S.optionalWith(S.Int.pipe(S.greaterThanOrEqualTo(0), S.lessThanOrEqualTo(1000)), {
    nullable: true,
    default: () => 1000 as const,
  }),
}) {}

export class StreamInfo extends S.Class<StreamInfo>('StreamInfo')({
  /**
   * Creation time in ISO 8601 format.
   */
  created_at: S.String,
  /**
   * Deletion time in ISO 8601 format, if the stream is being deleted.
   */
  deleted_at: S.optionalWith(S.String, { nullable: true }),
  /**
   * Stream name.
   */
  name: S.String,
}) {}

export class ListStreamsResponse extends S.Class<ListStreamsResponse>('ListStreamsResponse')({
  /**
   * Indicates that there are more results that match the criteria.
   */
  has_more: S.Boolean,
  /**
   * Matching streams.
   */
  streams: S.Array(StreamInfo).pipe(S.maxItems(1000)),
}) {}

export class CreateStreamRequest extends S.Class<CreateStreamRequest>('CreateStreamRequest')({
  config: S.optionalWith(StreamConfig, { nullable: true }),
  /**
   * Stream name that is unique to the basin.
   * It can be between 1 and 512 bytes in length.
   */
  stream: S.String,
}) {}

export class CreateOrReconfigureStreamParams extends S.Struct({
  's2-request-token': S.optionalWith(S.String, { nullable: true }),
}) {}

export class CreateOrReconfigureStreamRequest extends S.Union(S.Null, StreamConfig) {}

export class S2Format extends S.Literal('raw', 'base64') {}

export class U64 extends S.Int.pipe(S.greaterThanOrEqualTo(0)) {}

export class ReadParams extends S.Struct({
  's2-format': S.optionalWith(S2Format, { nullable: true }),
  seq_num: S.optionalWith(U64, { nullable: true }),
  timestamp: S.optionalWith(U64, { nullable: true }),
  tail_offset: S.optionalWith(S.Int.pipe(S.greaterThanOrEqualTo(0)), { nullable: true }),
  count: S.optionalWith(S.Int.pipe(S.greaterThanOrEqualTo(0)), { nullable: true }),
  bytes: S.optionalWith(S.Int.pipe(S.greaterThanOrEqualTo(0)), { nullable: true }),
  until: S.optionalWith(U64, { nullable: true }),
  clamp: S.optionalWith(S.Boolean, { nullable: true }),
}) {}

/**
 * Headers add structured information to a record as name-value pairs.
 *
 * The name cannot be empty, with the exception of an S2 command record.
 */
export class Header extends S.NonEmptyArray(S.String).pipe(S.minItems(2), S.maxItems(2)) {}

/**
 * Record that is durably sequenced on a stream.
 */
export class SequencedRecord extends S.Class<SequencedRecord>('SequencedRecord')({
  /**
   * Body of the record.
   */
  body: S.optionalWith(S.String, { nullable: true }),
  /**
   * Series of name-value pairs for this record.
   */
  headers: S.optionalWith(S.Array(Header), { nullable: true }),
  /**
   * Sequence number assigned by the service.
   */
  seq_num: U64,
  /**
   * Timestamp for this record.
   */
  timestamp: U64,
}) {}

/**
 * Position of a record in a stream.
 */
export class StreamPosition extends S.Class<StreamPosition>('StreamPosition')({
  /**
   * Sequence number assigned by the service.
   */
  seq_num: S.Int.pipe(S.greaterThanOrEqualTo(0)),
  /**
   * Timestamp, which may be client-specified or assigned by the service.
   * If it is assigned by the service, it will represent milliseconds since Unix epoch.
   */
  timestamp: S.Int.pipe(S.greaterThanOrEqualTo(0)),
}) {}

export class ReadBatch extends S.Class<ReadBatch>('ReadBatch')({
  /**
   * Records that are durably sequenced on the stream, retrieved based on the requested criteria.
   * This can only be empty in response to a regular (non-SSE) read, if the request cannot be satisfied without violating an explicit limit.
   */
  records: S.Array(SequencedRecord),
  tail: S.optionalWith(StreamPosition, { nullable: true }),
}) {}

export class TailResponse extends S.Class<TailResponse>('TailResponse')({
  /**
   * Sequence number that will be assigned to the next record on the stream, and timestamp of the last record.
   */
  tail: StreamPosition,
}) {}

export class AppendParams extends S.Struct({
  's2-format': S.optionalWith(S2Format, { nullable: true }),
}) {}

/**
 * Record to be appended to a stream.
 */
export class AppendRecord extends S.Class<AppendRecord>('AppendRecord')({
  /**
   * Body of the record.
   */
  body: S.optionalWith(S.String, { nullable: true }),
  /**
   * Series of name-value pairs for this record.
   */
  headers: S.optionalWith(S.Array(Header), { nullable: true }),
  timestamp: S.optionalWith(U64, { nullable: true }),
}) {}

/**
 * Payload of an `append` request.
 */
export class AppendInput extends S.Class<AppendInput>('AppendInput')({
  /**
   * Enforce a fencing token, which starts out as an empty string that can be overridden by a `fence` command record.
   */
  fencing_token: S.optionalWith(S.String, { nullable: true }),
  match_seq_num: S.optionalWith(U64, { nullable: true }),
  /**
   * Batch of records to append atomically, which must contain at least one record, and no more than 1000.
   * The total size of a batch of records may not exceed 1 MiB of metered bytes.
   */
  records: S.Array(AppendRecord),
}) {}

/**
 * Success response to an `append` request.
 */
export class AppendAck extends S.Class<AppendAck>('AppendAck')({
  /**
   * Sequence number of the last record that was appended `+ 1`, and timestamp of the last record that was appended.
   * The difference between `end.seq_num` and `start.seq_num` will be the number of records appended.
   */
  end: StreamPosition,
  /**
   * Sequence number and timestamp of the first record that was appended.
   */
  start: StreamPosition,
  /**
   * Sequence number that will be assigned to the next record on the stream, and timestamp of the last record on the stream.
   * This can be greater than the `end` position in case of concurrent appends.
   */
  tail: StreamPosition,
}) {}

/**
 * Aborted due to a failed condition.
 */
export class AppendConditionFailed extends S.Union(
  /**
   * Fencing token did not match.
   * The expected fencing token is returned.
   */
  S.Struct({
    /**
     * Fencing token did not match.
     * The expected fencing token is returned.
     */
    fencing_token_mismatch: S.String,
  }),
  /**
   * Sequence number did not match the tail of the stream.
   * The expected next sequence number is returned.
   */
  S.Struct({
    /**
     * Sequence number did not match the tail of the stream.
     * The expected next sequence number is returned.
     */
    seq_num_mismatch: S.Int.pipe(S.greaterThanOrEqualTo(0)),
  }),
) {}

export const make = (
  httpClient: HttpClient.HttpClient,
  options: {
    readonly transformClient?: ((client: HttpClient.HttpClient) => Effect.Effect<HttpClient.HttpClient>) | undefined
  } = {},
): Client => {
  const unexpectedStatus = (response: HttpClientResponse.HttpClientResponse) =>
    Effect.flatMap(
      Effect.orElseSucceed(response.json, () => 'Unexpected status code'),
      (description) =>
        Effect.fail(
          new HttpClientError.ResponseError({
            request: response.request,
            response,
            reason: 'StatusCode',
            description: typeof description === 'string' ? description : JSON.stringify(description),
          }),
        ),
    )
  const withResponse: <A, E>(
    f: (response: HttpClientResponse.HttpClientResponse) => Effect.Effect<A, E>,
  ) => (request: HttpClientRequest.HttpClientRequest) => Effect.Effect<any, any> = options.transformClient
    ? (f) => (request) =>
        Effect.flatMap(
          Effect.flatMap(options.transformClient!(httpClient), (client) => client.execute(request)),
          f,
        )
    : (f) => (request) => Effect.flatMap(httpClient.execute(request), f)
  const decodeSuccess =
    <A, I, R>(schema: S.Schema<A, I, R>) =>
    (response: HttpClientResponse.HttpClientResponse) =>
      HttpClientResponse.schemaBodyJson(schema)(response)
  const decodeError =
    <const Tag extends string, A, I, R>(tag: Tag, schema: S.Schema<A, I, R>) =>
    (response: HttpClientResponse.HttpClientResponse) =>
      Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)(response), (cause) =>
        Effect.fail(ClientError(tag, cause, response)),
      )
  return {
    httpClient,
    listAccessTokens: (options) =>
      HttpClientRequest.get(`/access-tokens`).pipe(
        HttpClientRequest.setUrlParams({
          prefix: options?.prefix as any,
          start_after: options?.start_after as any,
          limit: options?.limit as any,
        }),
        withResponse(
          HttpClientResponse.matchStatus({
            '2xx': decodeSuccess(ListAccessTokensResponse),
            '400': decodeError('ErrorResponse', ErrorResponse),
            '403': decodeError('ErrorResponse', ErrorResponse),
            orElse: unexpectedStatus,
          }),
        ),
      ),
    issueAccessToken: (options) =>
      HttpClientRequest.post(`/access-tokens`).pipe(
        HttpClientRequest.bodyUnsafeJson(options),
        withResponse(
          HttpClientResponse.matchStatus({
            '2xx': decodeSuccess(IssueAccessTokenResponse),
            '400': decodeError('ErrorResponse', ErrorResponse),
            '403': decodeError('ErrorResponse', ErrorResponse),
            '409': decodeError('ErrorResponse', ErrorResponse),
            orElse: unexpectedStatus,
          }),
        ),
      ),
    revokeAccessToken: (id) =>
      HttpClientRequest.del(`/access-tokens/${id}`).pipe(
        withResponse(
          HttpClientResponse.matchStatus({
            '400': decodeError('ErrorResponse', ErrorResponse),
            '403': decodeError('ErrorResponse', ErrorResponse),
            '200': () => Effect.void,
            orElse: unexpectedStatus,
          }),
        ),
      ),
    listBasins: (options) =>
      HttpClientRequest.get(`/basins`).pipe(
        HttpClientRequest.setUrlParams({
          prefix: options?.prefix as any,
          start_after: options?.start_after as any,
          limit: options?.limit as any,
        }),
        withResponse(
          HttpClientResponse.matchStatus({
            '2xx': decodeSuccess(ListBasinsResponse),
            '400': decodeError('ErrorResponse', ErrorResponse),
            '403': decodeError('ErrorResponse', ErrorResponse),
            orElse: unexpectedStatus,
          }),
        ),
      ),
    createBasin: (options) =>
      HttpClientRequest.post(`/basins`).pipe(
        HttpClientRequest.bodyUnsafeJson(options),
        withResponse(
          HttpClientResponse.matchStatus({
            '200': decodeSuccess(BasinInfo),
            '201': decodeSuccess(BasinInfo),
            '400': decodeError('ErrorResponse', ErrorResponse),
            '401': decodeError('ErrorResponse', ErrorResponse),
            '403': decodeError('ErrorResponse', ErrorResponse),
            '409': decodeError('ErrorResponse', ErrorResponse),
            orElse: unexpectedStatus,
          }),
        ),
      ),
    getBasinConfig: (basin) =>
      HttpClientRequest.get(`/basins/${basin}`).pipe(
        withResponse(
          HttpClientResponse.matchStatus({
            '2xx': decodeSuccess(BasinConfig),
            '400': decodeError('ErrorResponse', ErrorResponse),
            '403': decodeError('ErrorResponse', ErrorResponse),
            '404': decodeError('ErrorResponse', ErrorResponse),
            orElse: unexpectedStatus,
          }),
        ),
      ),
    createOrReconfigureBasin: (basin, options) =>
      HttpClientRequest.put(`/basins/${basin}`).pipe(
        HttpClientRequest.setHeaders({ 's2-request-token': options.params?.['s2-request-token'] ?? undefined }),
        HttpClientRequest.bodyUnsafeJson(options.payload),
        withResponse(
          HttpClientResponse.matchStatus({
            '200': decodeSuccess(BasinInfo),
            '201': decodeSuccess(BasinInfo),
            '400': decodeError('ErrorResponse', ErrorResponse),
            '204': () => Effect.void,
            orElse: unexpectedStatus,
          }),
        ),
      ),
    deleteBasin: (basin) =>
      HttpClientRequest.del(`/basins/${basin}`).pipe(
        withResponse(
          HttpClientResponse.matchStatus({
            '400': decodeError('ErrorResponse', ErrorResponse),
            '401': decodeError('ErrorResponse', ErrorResponse),
            '403': decodeError('ErrorResponse', ErrorResponse),
            '404': decodeError('ErrorResponse', ErrorResponse),
            '202': () => Effect.void,
            orElse: unexpectedStatus,
          }),
        ),
      ),
    reconfigureBasin: (basin, options) =>
      HttpClientRequest.patch(`/basins/${basin}`).pipe(
        HttpClientRequest.bodyUnsafeJson(options),
        withResponse(
          HttpClientResponse.matchStatus({
            '2xx': decodeSuccess(BasinConfig),
            '400': decodeError('ErrorResponse', ErrorResponse),
            '403': decodeError('ErrorResponse', ErrorResponse),
            '404': decodeError('ErrorResponse', ErrorResponse),
            orElse: unexpectedStatus,
          }),
        ),
      ),
    accountMetrics: (options) =>
      HttpClientRequest.get(`/metrics`).pipe(
        HttpClientRequest.setUrlParams({
          set: options?.set as any,
          start: options?.start as any,
          end: options?.end as any,
          interval: options?.interval as any,
        }),
        withResponse(
          HttpClientResponse.matchStatus({
            '2xx': decodeSuccess(MetricSetResponse),
            '400': decodeError('ErrorResponse', ErrorResponse),
            '403': decodeError('ErrorResponse', ErrorResponse),
            orElse: unexpectedStatus,
          }),
        ),
      ),
    basinMetrics: (basin, options) =>
      HttpClientRequest.get(`/metrics/${basin}`).pipe(
        HttpClientRequest.setUrlParams({
          set: options?.set as any,
          start: options?.start as any,
          end: options?.end as any,
          interval: options?.interval as any,
        }),
        withResponse(
          HttpClientResponse.matchStatus({
            '2xx': decodeSuccess(MetricSetResponse),
            '400': decodeError('ErrorResponse', ErrorResponse),
            '403': decodeError('ErrorResponse', ErrorResponse),
            orElse: unexpectedStatus,
          }),
        ),
      ),
    streamMetrics: (basin, stream, options) =>
      HttpClientRequest.get(`/metrics/${basin}/${stream}`).pipe(
        HttpClientRequest.setUrlParams({
          set: options?.set as any,
          start: options?.start as any,
          end: options?.end as any,
          interval: options?.interval as any,
        }),
        withResponse(
          HttpClientResponse.matchStatus({
            '2xx': decodeSuccess(MetricSetResponse),
            '400': decodeError('ErrorResponse', ErrorResponse),
            '403': decodeError('ErrorResponse', ErrorResponse),
            orElse: unexpectedStatus,
          }),
        ),
      ),
    listStreams: (options) =>
      HttpClientRequest.get(`/streams`).pipe(
        HttpClientRequest.setUrlParams({
          prefix: options?.prefix as any,
          start_after: options?.start_after as any,
          limit: options?.limit as any,
        }),
        withResponse(
          HttpClientResponse.matchStatus({
            '2xx': decodeSuccess(ListStreamsResponse),
            '400': decodeError('ErrorResponse', ErrorResponse),
            '403': decodeError('ErrorResponse', ErrorResponse),
            '404': decodeError('ErrorResponse', ErrorResponse),
            orElse: unexpectedStatus,
          }),
        ),
      ),
    createStream: (options) =>
      HttpClientRequest.post(`/streams`).pipe(
        HttpClientRequest.bodyUnsafeJson(options),
        withResponse(
          HttpClientResponse.matchStatus({
            '2xx': decodeSuccess(StreamInfo),
            '400': decodeError('ErrorResponse', ErrorResponse),
            '403': decodeError('ErrorResponse', ErrorResponse),
            '404': decodeError('ErrorResponse', ErrorResponse),
            '409': decodeError('ErrorResponse', ErrorResponse),
            orElse: unexpectedStatus,
          }),
        ),
      ),
    getStreamConfig: (stream) =>
      HttpClientRequest.get(`/streams/${stream}`).pipe(
        withResponse(
          HttpClientResponse.matchStatus({
            '2xx': decodeSuccess(StreamConfig),
            '400': decodeError('ErrorResponse', ErrorResponse),
            '403': decodeError('ErrorResponse', ErrorResponse),
            '404': decodeError('ErrorResponse', ErrorResponse),
            '409': decodeError('ErrorResponse', ErrorResponse),
            orElse: unexpectedStatus,
          }),
        ),
      ),
    createOrReconfigureStream: (stream, options) =>
      HttpClientRequest.put(`/streams/${stream}`).pipe(
        HttpClientRequest.setHeaders({ 's2-request-token': options.params?.['s2-request-token'] ?? undefined }),
        HttpClientRequest.bodyUnsafeJson(options.payload),
        withResponse(
          HttpClientResponse.matchStatus({
            '2xx': decodeSuccess(StreamInfo),
            '400': decodeError('ErrorResponse', ErrorResponse),
            '403': decodeError('ErrorResponse', ErrorResponse),
            '404': decodeError('ErrorResponse', ErrorResponse),
            '409': decodeError('ErrorResponse', ErrorResponse),
            '204': () => Effect.void,
            orElse: unexpectedStatus,
          }),
        ),
      ),
    deleteStream: (stream) =>
      HttpClientRequest.del(`/streams/${stream}`).pipe(
        withResponse(
          HttpClientResponse.matchStatus({
            '400': decodeError('ErrorResponse', ErrorResponse),
            '403': decodeError('ErrorResponse', ErrorResponse),
            '404': decodeError('ErrorResponse', ErrorResponse),
            '202': () => Effect.void,
            orElse: unexpectedStatus,
          }),
        ),
      ),
    reconfigureStream: (stream, options) =>
      HttpClientRequest.patch(`/streams/${stream}`).pipe(
        HttpClientRequest.bodyUnsafeJson(options),
        withResponse(
          HttpClientResponse.matchStatus({
            '2xx': decodeSuccess(StreamConfig),
            '400': decodeError('ErrorResponse', ErrorResponse),
            '403': decodeError('ErrorResponse', ErrorResponse),
            '404': decodeError('ErrorResponse', ErrorResponse),
            '409': decodeError('ErrorResponse', ErrorResponse),
            orElse: unexpectedStatus,
          }),
        ),
      ),
    read: (stream, options) =>
      HttpClientRequest.get(`/streams/${stream}/records`).pipe(
        HttpClientRequest.setUrlParams({
          seq_num: options?.seq_num as any,
          timestamp: options?.timestamp as any,
          tail_offset: options?.tail_offset as any,
          count: options?.count as any,
          bytes: options?.bytes as any,
          until: options?.until as any,
          clamp: options?.clamp as any,
        }),
        HttpClientRequest.setHeaders({ 's2-format': options?.['s2-format'] ?? undefined }),
        withResponse(
          HttpClientResponse.matchStatus({
            '2xx': decodeSuccess(ReadBatch),
            '400': decodeError('ErrorResponse', ErrorResponse),
            '401': decodeError('ErrorResponse', ErrorResponse),
            '404': decodeError('ErrorResponse', ErrorResponse),
            '409': decodeError('ErrorResponse', ErrorResponse),
            '416': decodeError('TailResponse', TailResponse),
            '500': decodeError('ErrorResponse', ErrorResponse),
            orElse: unexpectedStatus,
          }),
        ),
      ),
    append: (stream, options) =>
      HttpClientRequest.post(`/streams/${stream}/records`).pipe(
        HttpClientRequest.setHeaders({ 's2-format': options.params?.['s2-format'] ?? undefined }),
        HttpClientRequest.bodyUnsafeJson(options.payload),
        withResponse(
          HttpClientResponse.matchStatus({
            '2xx': decodeSuccess(AppendAck),
            '400': decodeError('ErrorResponse', ErrorResponse),
            '401': decodeError('ErrorResponse', ErrorResponse),
            '404': decodeError('ErrorResponse', ErrorResponse),
            '409': decodeError('ErrorResponse', ErrorResponse),
            '412': decodeError('AppendConditionFailed', AppendConditionFailed),
            '500': decodeError('ErrorResponse', ErrorResponse),
            orElse: unexpectedStatus,
          }),
        ),
      ),
    checkTail: (stream) =>
      HttpClientRequest.get(`/streams/${stream}/records/tail`).pipe(
        withResponse(
          HttpClientResponse.matchStatus({
            '2xx': decodeSuccess(TailResponse),
            '400': decodeError('ErrorResponse', ErrorResponse),
            '401': decodeError('ErrorResponse', ErrorResponse),
            '404': decodeError('ErrorResponse', ErrorResponse),
            '409': decodeError('ErrorResponse', ErrorResponse),
            '500': decodeError('ErrorResponse', ErrorResponse),
            orElse: unexpectedStatus,
          }),
        ),
      ),
  }
}

export interface Client {
  readonly httpClient: HttpClient.HttpClient
  /**
   * List access tokens.
   */
  readonly listAccessTokens: (
    options?: typeof ListAccessTokensParams.Encoded | undefined,
  ) => Effect.Effect<
    typeof ListAccessTokensResponse.Type,
    | HttpClientError.HttpClientError
    | ParseResult.ParseError
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
  >
  /**
   * Issue a new access token.
   */
  readonly issueAccessToken: (
    options: typeof AccessTokenInfo.Encoded,
  ) => Effect.Effect<
    typeof IssueAccessTokenResponse.Type,
    | HttpClientError.HttpClientError
    | ParseResult.ParseError
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
  >
  /**
   * Revoke an access token.
   */
  readonly revokeAccessToken: (
    id: string,
  ) => Effect.Effect<
    void,
    | HttpClientError.HttpClientError
    | ParseResult.ParseError
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
  >
  /**
   * List basins.
   */
  readonly listBasins: (
    options?: typeof ListBasinsParams.Encoded | undefined,
  ) => Effect.Effect<
    typeof ListBasinsResponse.Type,
    | HttpClientError.HttpClientError
    | ParseResult.ParseError
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
  >
  /**
   * Create a basin.
   */
  readonly createBasin: (
    options: typeof CreateBasinRequest.Encoded,
  ) => Effect.Effect<
    typeof BasinInfo.Type | typeof BasinInfo.Type,
    | HttpClientError.HttpClientError
    | ParseResult.ParseError
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
  >
  /**
   * Get basin configuration.
   */
  readonly getBasinConfig: (
    basin: string,
  ) => Effect.Effect<
    typeof BasinConfig.Type,
    | HttpClientError.HttpClientError
    | ParseResult.ParseError
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
  >
  /**
   * Create or reconfigure a basin.
   */
  readonly createOrReconfigureBasin: (
    basin: string,
    options: {
      readonly params?: typeof CreateOrReconfigureBasinParams.Encoded | undefined
      readonly payload: typeof CreateOrReconfigureBasinRequest.Encoded
    },
  ) => Effect.Effect<
    typeof BasinInfo.Type | typeof BasinInfo.Type,
    HttpClientError.HttpClientError | ParseResult.ParseError | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
  >
  /**
   * Delete a basin.
   */
  readonly deleteBasin: (
    basin: string,
  ) => Effect.Effect<
    void,
    | HttpClientError.HttpClientError
    | ParseResult.ParseError
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
  >
  /**
   * Reconfigure a basin.
   */
  readonly reconfigureBasin: (
    basin: string,
    options: typeof BasinReconfiguration.Encoded,
  ) => Effect.Effect<
    typeof BasinConfig.Type,
    | HttpClientError.HttpClientError
    | ParseResult.ParseError
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
  >
  /**
   * Account-level metrics.
   */
  readonly accountMetrics: (
    options: typeof AccountMetricsParams.Encoded,
  ) => Effect.Effect<
    typeof MetricSetResponse.Type,
    | HttpClientError.HttpClientError
    | ParseResult.ParseError
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
  >
  /**
   * Basin-level metrics.
   */
  readonly basinMetrics: (
    basin: string,
    options: typeof BasinMetricsParams.Encoded,
  ) => Effect.Effect<
    typeof MetricSetResponse.Type,
    | HttpClientError.HttpClientError
    | ParseResult.ParseError
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
  >
  /**
   * Stream-level metrics.
   */
  readonly streamMetrics: (
    basin: string,
    stream: string,
    options: typeof StreamMetricsParams.Encoded,
  ) => Effect.Effect<
    typeof MetricSetResponse.Type,
    | HttpClientError.HttpClientError
    | ParseResult.ParseError
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
  >
  /**
   * List streams.
   */
  readonly listStreams: (
    options?: typeof ListStreamsParams.Encoded | undefined,
  ) => Effect.Effect<
    typeof ListStreamsResponse.Type,
    | HttpClientError.HttpClientError
    | ParseResult.ParseError
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
  >
  /**
   * Create a stream.
   */
  readonly createStream: (
    options: typeof CreateStreamRequest.Encoded,
  ) => Effect.Effect<
    typeof StreamInfo.Type,
    | HttpClientError.HttpClientError
    | ParseResult.ParseError
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
  >
  /**
   * Get stream configuration.
   */
  readonly getStreamConfig: (
    stream: string,
  ) => Effect.Effect<
    typeof StreamConfig.Type,
    | HttpClientError.HttpClientError
    | ParseResult.ParseError
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
  >
  /**
   * Create or reconfigure a stream.
   */
  readonly createOrReconfigureStream: (
    stream: string,
    options: {
      readonly params?: typeof CreateOrReconfigureStreamParams.Encoded | undefined
      readonly payload: typeof CreateOrReconfigureStreamRequest.Encoded
    },
  ) => Effect.Effect<
    typeof StreamInfo.Type,
    | HttpClientError.HttpClientError
    | ParseResult.ParseError
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
  >
  /**
   * Delete a stream.
   */
  readonly deleteStream: (
    stream: string,
  ) => Effect.Effect<
    void,
    | HttpClientError.HttpClientError
    | ParseResult.ParseError
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
  >
  /**
   * Reconfigure a stream.
   */
  readonly reconfigureStream: (
    stream: string,
    options: typeof StreamReconfiguration.Encoded,
  ) => Effect.Effect<
    typeof StreamConfig.Type,
    | HttpClientError.HttpClientError
    | ParseResult.ParseError
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
  >
  /**
   * Read records.
   */
  readonly read: (
    stream: string,
    options?: typeof ReadParams.Encoded | undefined,
  ) => Effect.Effect<
    typeof ReadBatch.Type,
    | HttpClientError.HttpClientError
    | ParseResult.ParseError
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
    | ClientError<'TailResponse', typeof TailResponse.Type>
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
  >
  /**
   * Append records.
   */
  readonly append: (
    stream: string,
    options: {
      readonly params?: typeof AppendParams.Encoded | undefined
      readonly payload: typeof AppendInput.Encoded
    },
  ) => Effect.Effect<
    typeof AppendAck.Type,
    | HttpClientError.HttpClientError
    | ParseResult.ParseError
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
    | ClientError<'AppendConditionFailed', typeof AppendConditionFailed.Type>
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
  >
  /**
   * Check the tail.
   */
  readonly checkTail: (
    stream: string,
  ) => Effect.Effect<
    typeof TailResponse.Type,
    | HttpClientError.HttpClientError
    | ParseResult.ParseError
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
    | ClientError<'ErrorResponse', typeof ErrorResponse.Type>
  >
}

export interface ClientError<Tag extends string, E> {
  readonly _tag: Tag
  readonly request: HttpClientRequest.HttpClientRequest
  readonly response: HttpClientResponse.HttpClientResponse
  readonly cause: E
}

class ClientErrorImpl extends Data.Error<{
  _tag: string
  cause: any
  request: HttpClientRequest.HttpClientRequest
  response: HttpClientResponse.HttpClientResponse
}> {}

export const ClientError = <Tag extends string, E>(
  tag: Tag,
  cause: E,
  response: HttpClientResponse.HttpClientResponse,
): ClientError<Tag, E> =>
  new ClientErrorImpl({
    _tag: tag,
    cause,
    response,
    request: response.request,
  }) as any
