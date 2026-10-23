import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GetMetricDataCommandInput } from '@aws-sdk/client-cloudwatch';
import {
	createReliabilityHandler,
	type ReliabilityResponse,
} from '../backend/handlers/reliability';

const now = new Date('2026-10-22T10:00:00.000Z');
const observedAt = new Date('2026-10-22T09:00:00.000Z');

type FixtureOptions = {
	missing?: string[];
	partial?: string[];
	windowValues?: Record<string, number[]>;
	requestsPerHour?: number;
	errorsPerHour?: number;
};

function metricResponse(
	input: GetMetricDataCommandInput,
	options: FixtureOptions = {},
) {
	const budgetQuery = input.MetricDataQueries?.some((query) => query.Id === 'budget_requests');
	const timestamps = budgetQuery
		? Array.from({ length: 720 }, (_, index) =>
			new Date((input.StartTime as Date).getTime() + index * 3_600_000),
		)
		: [observedAt];
	const values: Record<string, number[]> = budgetQuery
		? {
			budget_requests: Array(720).fill(options.requestsPerHour ?? 10),
			budget_errors: Array(720).fill(options.errorsPerHour ?? 1),
		}
		: {
			api_requests: [100],
			api_4xx: [5],
			api_5xx: [2],
			api_latency_average: [100],
			api_latency_samples: [100],
			api_latency_p50: [80],
			api_latency_p95: [250],
			personal_site_weather_invocations: [10],
			personal_site_weather_errors: [1],
			personal_site_weather_throttles: [0],
			personal_site_weather_duration_average: [20],
			personal_site_weather_duration_samples: [10],
		};
	Object.assign(values, options.windowValues);

	for (const prefix of ['feedback', 'health', 'movies']) {
		values[`personal_site_${prefix}_invocations`] = [10];
		values[`personal_site_${prefix}_errors`] = [1];
		values[`personal_site_${prefix}_throttles`] = [0];
		values[`personal_site_${prefix}_duration_average`] = [20];
		values[`personal_site_${prefix}_duration_samples`] = [10];
	}

	return {
		$metadata: {},
		MetricDataResults: (input.MetricDataQueries ?? []).map((query) => {
			const id = query.Id ?? '';
			if (options.missing?.includes(id)) {
				return {
					Id: id,
					StatusCode: 'Complete' as const,
					Timestamps: [],
					Values: [],
				};
			}
			const partial = budgetQuery && options.partial?.includes(id);
			return {
				Id: id,
				StatusCode: 'Complete' as const,
				Timestamps: partial ? timestamps.slice(0, -1) : timestamps,
				Values: partial ? (values[id] ?? [0]).slice(0, -1) : values[id] ?? [0],
			};
		}),
	};
}

function bodyOf(response: { body: string }): ReliabilityResponse {
	return JSON.parse(response.body) as ReliabilityResponse;
}

beforeEach(() => {
	vi.stubEnv('API_ID', 'api-test');
	vi.stubEnv('API_STAGE', '$default');
	vi.stubEnv('SLO_AVAILABILITY_TARGET', '0.99');
	vi.stubEnv('SLO_API_LATENCY_P95_TARGET_MS', '500');
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});

describe('reliability query validation', () => {
	it('uses explicitly supplied environment values for local configuration', async () => {
		const getMetricData = vi.fn(async (input) => metricResponse(input));
		const handler = createReliabilityHandler({
			environment: {
				API_ID: 'api-from-dotenv',
				API_STAGE: '$default',
			},
			getMetricData,
		});

		const response = await handler({});

		expect(response.statusCode).toBe(200);
		expect(bodyOf(response).objectives).toEqual({
			availability: 0.999,
			apiLatencyP95Ms: 1_000,
		});
		expect(getMetricData).toHaveBeenCalled();
	});

	it('reports missing local API configuration without querying CloudWatch', async () => {
		const getMetricData = vi.fn();
		const handler = createReliabilityHandler({
			environment: {},
			getMetricData,
		});

		const response = await handler({});

		expect(response.statusCode).toBe(503);
		expect(JSON.parse(response.body)).toEqual({
			status: 'error',
			error: 'Reliability metrics are not configured.',
		});
		expect(getMetricData).not.toHaveBeenCalled();
	});

	it.each(['0', '721', '1.5', '24hours', ''])('rejects invalid hours value %j', async (hours) => {
		const getMetricData = vi.fn();
		const response = await createReliabilityHandler({ getMetricData })({
			queryStringParameters: { hours },
		});

		expect(response.statusCode).toBe(400);
		expect(getMetricData).not.toHaveBeenCalled();
	});

	it('rejects unknown query parameters', async () => {
		const getMetricData = vi.fn();
		const response = await createReliabilityHandler({ getMetricData })({
			queryStringParameters: { query: 'anything' },
		});

		expect(response.statusCode).toBe(400);
		expect(getMetricData).not.toHaveBeenCalled();
	});

	it('uses a bounded 24-hour window by default', async () => {
		const calls: GetMetricDataCommandInput[] = [];
		const handler = createReliabilityHandler({
			now: () => now,
			getMetricData: async (input) => {
				calls.push(input);
				return metricResponse(input);
			},
		});

		const response = await handler({});
		const body = bodyOf(response);

		expect(response.statusCode).toBe(200);
		expect(body.window).toEqual({
			start: '2026-10-21T10:00:00.000Z',
			end: '2026-10-22T10:00:00.000Z',
			hours: 24,
		});
		expect(calls).toHaveLength(2);
	});

	it('uses complete CloudWatch periods for the reported measurement window', async () => {
		const handler = createReliabilityHandler({
			now: () => new Date('2026-10-22T10:27:45.000Z'),
			getMetricData: async (input) => metricResponse(input),
		});

		const body = bodyOf(await handler({ queryStringParameters: { hours: '1' } }));

		expect(body.window).toEqual({
			start: '2026-10-22T09:27:00.000Z',
			end: '2026-10-22T10:27:00.000Z',
			hours: 1,
		});
	});
});

describe('CloudWatch query construction and response mapping', () => {
	it('queries only fixed API/Lambda metrics with expected dimensions', async () => {
		let windowQuery: GetMetricDataCommandInput | undefined;
		const handler = createReliabilityHandler({
			now: () => now,
			getMetricData: async (input) => {
				if (input.MetricDataQueries?.some((query) => query.Id === 'api_requests')) {
					windowQuery = input;
				}
				return metricResponse(input);
			},
		});

		await handler({ queryStringParameters: { hours: '6' } });

		const requestQuery = windowQuery?.MetricDataQueries?.find((query) =>
			query.Id === 'api_requests',
		);
		expect(requestQuery?.MetricStat?.Metric).toMatchObject({
			Namespace: 'AWS/ApiGateway',
			MetricName: 'Count',
			Dimensions: [
				{ Name: 'ApiId', Value: 'api-test' },
				{ Name: 'Stage', Value: '$default' },
			],
		});
		expect(requestQuery?.MetricStat?.Stat).toBe('Sum');
		const lambdaQuery = windowQuery?.MetricDataQueries?.find((query) =>
			query.Id === 'personal_site_weather_invocations',
		);
		expect(lambdaQuery?.MetricStat?.Metric).toMatchObject({
			Namespace: 'AWS/Lambda',
			MetricName: 'Invocations',
			Dimensions: [{ Name: 'FunctionName', Value: 'personal-site-weather' }],
		});
		expect(windowQuery?.MetricDataQueries?.some((query) =>
			query.Id?.includes('personal_site_reliability'),
		)).toBe(false);
	});

	it('maps measurements, configured objectives, and the 30-day error budget', async () => {
		const handler = createReliabilityHandler({
			now: () => now,
			getMetricData: async (input) => metricResponse(input),
		});

		const response = await handler({});
		const body = bodyOf(response);

		expect(response.statusCode).toBe(200);
		expect(body.schemaVersion).toBe(1);
		expect(body.objectives).toEqual({
			availability: 0.99,
			apiLatencyP95Ms: 500,
		});
		expect(body.metrics.apiGateway).toMatchObject({
			requestCount: { value: 100, status: 'available' },
			clientErrorCount: { value: 5, status: 'available' },
			serverErrorCount: { value: 2, status: 'available' },
			serverErrorRate: { value: 0.02, status: 'available' },
			latencyMs: {
				average: { value: 100, status: 'available' },
				p50: { value: 80, status: 'available' },
				p95: { value: 250, status: 'available' },
			},
		});
		expect(body.slis.availability).toMatchObject({
			value: { value: 0.98, status: 'available' },
			target: 0.99,
			errorClassification: 'API Gateway HTTP 5xx responses',
		});
		expect(body.slis.apiLatencyP95).toMatchObject({
			value: { value: 250, status: 'available' },
			targetMs: 500,
		});
		expect(body.metrics.lambda).toHaveLength(4);
		expect(body.metrics.lambda[0]).toMatchObject({
			name: 'Weather',
			invocations: { value: 10, status: 'available' },
			errors: { value: 1, status: 'available' },
			throttles: { value: 0, status: 'available' },
			durationAverageMs: { value: 20, status: 'available' },
		});
		expect(body.errorBudget).toMatchObject({
			status: 'available',
			target: 0.99,
			periodHours: 720,
			requestCount: { value: 7_200, status: 'available' },
			serverErrorCount: { value: 720, status: 'available' },
			allowedServerErrors: 72,
			consumedPercent: { value: 1_000 },
			remainingPercent: { value: 0 },
			coverage: { expectedHours: 720, requestHours: 720, serverErrorHours: 720 },
		});
	});

	it('reports the latest one-minute percentile bucket instead of combining the selected window', async () => {
		let windowQuery: GetMetricDataCommandInput | undefined;
		const handler = createReliabilityHandler({
			now: () => now,
			getMetricData: async (input) => {
				if (input.MetricDataQueries?.some((query) => query.Id === 'api_requests')) {
					windowQuery = input;
				}
				return metricResponse(input);
			},
		});

		const body = bodyOf(await handler({ queryStringParameters: { hours: '168' } }));

		expect(body.metrics.apiGateway.latencyMs.p50).toMatchObject({
			value: 80,
			status: 'available',
		});
		expect(body.metrics.apiGateway.latencyMs.percentilePeriodSeconds).toBe(60);
		expect(windowQuery?.MetricDataQueries?.find((query) =>
			query.Id === 'api_latency_p95',
		)?.MetricStat?.Period).toBe(60);
	});

	it('uses five-minute percentile buckets when the selected window exceeds 14 days', async () => {
		let windowQuery: GetMetricDataCommandInput | undefined;
		const handler = createReliabilityHandler({
			now: () => now,
			getMetricData: async (input) => {
				if (input.MetricDataQueries?.some((query) => query.Id === 'api_requests')) {
					windowQuery = input;
				}
				return metricResponse(input);
			},
		});

		const body = bodyOf(await handler({ queryStringParameters: { hours: '720' } }));

		expect(body.metrics.apiGateway.latencyMs.percentilePeriodSeconds).toBe(300);
		expect(windowQuery?.MetricDataQueries?.find((query) =>
			query.Id === 'api_latency_p95',
		)?.MetricStat?.Period).toBe(300);
	});

	it('reports missing API metrics as unavailable rather than zero', async () => {
		const handler = createReliabilityHandler({
			now: () => now,
			getMetricData: async (input) => metricResponse(input, {
				missing: ['api_requests', 'api_5xx', 'budget_requests', 'budget_errors'],
			}),
		});

		const body = bodyOf(await handler({}));

		expect(body.metrics.apiGateway.requestCount).toMatchObject({
			value: null,
			status: 'unavailable',
		});
		expect(body.slis.availability.value).toMatchObject({
			value: null,
			status: 'unavailable',
		});
		expect(body.errorBudget).toMatchObject({
			status: 'unavailable',
			coverage: { requestHours: 0, serverErrorHours: 0 },
		});
	});

	it('requires complete hourly coverage before reporting the error budget', async () => {
		const handler = createReliabilityHandler({
			now: () => now,
			getMetricData: async (input) => metricResponse(input, {
				missing: ['budget_errors'],
			}),
		});

		const body = bodyOf(await handler({}));

		expect(body.errorBudget.status).toBe('unavailable');
		expect(body.errorBudget.coverage.serverErrorHours).toBe(0);
		expect(body.errorBudget.reason).toContain('every hour');
	});

	it('requires both a positive denominator and consistent server-error totals', async () => {
		const noTrafficHandler = createReliabilityHandler({
			now: () => now,
			getMetricData: async (input) => metricResponse(input, {
				windowValues: { api_requests: [0], api_5xx: [0] },
			}),
		});
		const noTraffic = bodyOf(await noTrafficHandler({}));
		expect(noTraffic.slis.availability.value).toMatchObject({
			value: null,
			status: 'unavailable',
		});
		expect(noTraffic.slis.availability.value.reason).toContain('positive');

		const inconsistentHandler = createReliabilityHandler({
			now: () => now,
			getMetricData: async (input) => metricResponse(input, {
				windowValues: { api_requests: [1], api_5xx: [2] },
			}),
		});
		const inconsistent = bodyOf(await inconsistentHandler({}));
		expect(inconsistent.slis.availability.value).toMatchObject({
			value: null,
			status: 'unavailable',
		});
		expect(inconsistent.slis.availability.value.reason).toContain('inconsistent');
	});

	it('marks percentage error-budget consumption unavailable for a 100% objective', async () => {
		vi.stubEnv('SLO_AVAILABILITY_TARGET', '1');
		const handler = createReliabilityHandler({
			now: () => now,
			getMetricData: async (input) => metricResponse(input, {
				errorsPerHour: 0,
			}),
		});

		const body = bodyOf(await handler({}));

		expect(body.slis.availability.target).toBe(1);
		expect(body.errorBudget).toMatchObject({
			status: 'unavailable',
			reason: 'A 100% availability objective allows no errors, so percentage budget consumption is undefined.',
		});
	});

	it('withholds the 30-day budget when only one hourly bucket is missing', async () => {
		const handler = createReliabilityHandler({
			now: () => now,
			getMetricData: async (input) => metricResponse(input, {
				partial: ['budget_errors'],
			}),
		});

		const body = bodyOf(await handler({}));

		expect(body.errorBudget.status).toBe('unavailable');
		expect(body.errorBudget.coverage).toMatchObject({
			expectedHours: 720,
			requestHours: 720,
			serverErrorHours: 719,
		});
	});
});

describe('reliability service errors and configuration', () => {
	it('requires the deployed API identifier and stage', async () => {
		vi.stubEnv('API_ID', '');
		const getMetricData = vi.fn();

		const response = await createReliabilityHandler({ getMetricData })({});

		expect(response.statusCode).toBe(503);
		expect(getMetricData).not.toHaveBeenCalled();
	});

	it('rejects invalid SLO configuration without returning a false objective', async () => {
		vi.stubEnv('SLO_AVAILABILITY_TARGET', '1.2');
		const getMetricData = vi.fn();

		const response = await createReliabilityHandler({ getMetricData })({});

		expect(response.statusCode).toBe(503);
		expect(JSON.parse(response.body).error).toContain('not configured');
		expect(getMetricData).not.toHaveBeenCalled();
	});

	it('returns safe errors for CloudWatch failures and throttling', async () => {
		const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const failure = new Error('private CloudWatch details');
		const failedHandler = createReliabilityHandler({
			getMetricData: async () => {
				throw failure;
			},
		});
		const failedResponse = await failedHandler({});

		expect(failedResponse.statusCode).toBe(502);
		expect(failedResponse.body).not.toContain('private CloudWatch details');
		expect(errorLog).toHaveBeenCalledOnce();

		const throttled = new Error('private throttling details');
		throttled.name = 'ThrottlingException';
		const throttledResponse = await createReliabilityHandler({
			getMetricData: async () => {
				throw throttled;
			},
		})({});

		expect(throttledResponse.statusCode).toBe(503);
		expect(throttledResponse.body).not.toContain('private throttling details');
	});

	it('rejects incomplete CloudWatch query results without exposing result details', async () => {
		const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const handler = createReliabilityHandler({
			getMetricData: async (input) => ({
				$metadata: {},
				MetricDataResults: input.MetricDataQueries?.map((query) => ({
					Id: query.Id,
					StatusCode: query.Id === 'api_requests' ? 'InternalError' : 'Complete',
					Timestamps: [],
					Values: [],
					Messages: query.Id === 'api_requests'
						? [{ Code: 'InternalError', Value: 'private CloudWatch diagnostic' }]
						: [],
				})),
			}),
		});

		const response = await handler({});

		expect(response.statusCode).toBe(502);
		expect(response.body).not.toContain('private CloudWatch diagnostic');
		expect(JSON.parse(response.body).error).toContain('incomplete');
		expect(errorLog).toHaveBeenCalledOnce();
	});
});
