import {
	CloudWatchClient,
	GetMetricDataCommand,
	type GetMetricDataCommandInput,
	type GetMetricDataCommandOutput,
	type MetricDataResult,
} from '@aws-sdk/client-cloudwatch';
import { jsonResponse, type HttpApiEvent, type HttpApiResponse } from './http.js';

const defaultAvailabilityTarget = 0.999;
const defaultApiLatencyP95TargetMs = 1_000;
const maximumWindowHours = 24 * 30;
const errorBudgetHours = 30 * 24;
const lambdaFunctions = [
	{ functionName: 'personal-site-weather', name: 'Weather' },
	{ functionName: 'personal-site-feedback', name: 'Feedback' },
	{ functionName: 'personal-site-health', name: 'Health' },
	{ functionName: 'personal-site-movies', name: 'Movies' },
] as const;

export type ReliabilityMetricValue = {
	value: number | null;
	timestamp: string | null;
	status: 'available' | 'unavailable';
	reason?: string;
};

export type ReliabilityResponse = {
	[key: string]: unknown;
	schemaVersion: 1;
	generatedAt: string;
	window: { start: string; end: string; hours: number };
	objectives: { availability: number; apiLatencyP95Ms: number };
	metrics: {
		apiGateway: {
			requestCount: ReliabilityMetricValue;
			clientErrorCount: ReliabilityMetricValue;
			serverErrorCount: ReliabilityMetricValue;
			serverErrorRate: ReliabilityMetricValue;
			latencyMs: {
				average: ReliabilityMetricValue;
				p50: ReliabilityMetricValue;
				p95: ReliabilityMetricValue;
				percentilePeriodSeconds: number;
			};
		};
		lambda: Array<{
			name: string;
			functionName: string;
			invocations: ReliabilityMetricValue;
			errors: ReliabilityMetricValue;
			throttles: ReliabilityMetricValue;
			durationAverageMs: ReliabilityMetricValue;
		}>;
	};
	slis: {
		availability: {
			value: ReliabilityMetricValue;
			target: number;
			numerator: ReliabilityMetricValue;
			denominator: ReliabilityMetricValue;
			errorClassification: string;
		};
		apiLatencyP95: { value: ReliabilityMetricValue; targetMs: number };
	};
	errorBudget: {
		status: 'available' | 'unavailable';
		target: number;
		periodHours: number;
		requestCount: ReliabilityMetricValue;
		serverErrorCount: ReliabilityMetricValue;
		allowedServerErrors?: number;
		consumedPercent?: ReliabilityMetricValue;
		remainingPercent?: ReliabilityMetricValue;
		coverage: {
			expectedHours: number;
			requestHours: number;
			serverErrorHours: number;
		};
		reason?: string;
	};
};

type MetricValue = ReliabilityMetricValue;

type MetricSpec = {
	id: string;
	namespace: string;
	name: string;
	dimensions: { Name: string; Value: string }[];
	stat: string;
	period: number;
};

type ReliabilityConfiguration = {
	apiId: string;
	stage: string;
	availabilityTarget: number;
	apiLatencyP95TargetMs: number;
};

type HandlerDependencies = {
	getMetricData?: (input: GetMetricDataCommandInput) => Promise<GetMetricDataCommandOutput>;
	now?: () => Date;
	environment?: Record<string, string | undefined>;
};

class IncompleteMetricResultsError extends Error {}

function unavailable(reason: string): MetricValue {
	return { value: null, timestamp: null, status: 'unavailable', reason };
}

function available(value: number, timestamp: string | null): MetricValue {
	return { value, timestamp, status: 'available' };
}

function parseHours(value: string | undefined): number | undefined {
	if (value === undefined) return 24;
	if (!/^\d+$/.test(value)) return undefined;
	const hours = Number(value);
	return Number.isInteger(hours) && hours >= 1 && hours <= maximumWindowHours
		? hours
		: undefined;
}

function parseConfiguration(
	environment: Record<string, string | undefined> = process.env,
): ReliabilityConfiguration | undefined {
	const apiId = environment.API_ID?.trim();
	const stage = environment.API_STAGE?.trim();
	const availabilityTarget = Number(
		environment.SLO_AVAILABILITY_TARGET ?? defaultAvailabilityTarget,
	);
	const apiLatencyP95TargetMs = Number(
		environment.SLO_API_LATENCY_P95_TARGET_MS ?? defaultApiLatencyP95TargetMs,
	);

	if (
		!apiId ||
		!stage ||
		!Number.isFinite(availabilityTarget) ||
		availabilityTarget <= 0 ||
		availabilityTarget > 1 ||
		!Number.isFinite(apiLatencyP95TargetMs) ||
		apiLatencyP95TargetMs <= 0 ||
		apiLatencyP95TargetMs > 120_000
	) {
		return undefined;
	}

	return { apiId, stage, availabilityTarget, apiLatencyP95TargetMs };
}

function metricQuery(spec: MetricSpec) {
	return {
		Id: spec.id,
		MetricStat: {
			Metric: {
				Namespace: spec.namespace,
				MetricName: spec.name,
				Dimensions: spec.dimensions,
			},
			Period: spec.period,
			Stat: spec.stat,
		},
		ReturnData: true,
	};
}

function findResult(results: MetricDataResult[], id: string): MetricDataResult | undefined {
	return results.find((result) => result.Id === id);
}

function timestampFor(result: MetricDataResult | undefined): string | null {
	const latest = result?.Timestamps?.reduce<Date | undefined>(
		(current, timestamp) => !current || timestamp > current ? timestamp : current,
		undefined,
	);
	return latest?.toISOString() ?? null;
}

function sumMetric(
	results: MetricDataResult[],
	id: string,
	reason: string,
): MetricValue {
	const result = findResult(results, id);
	const values = result?.Values ?? [];
	if (!values.length) return unavailable(reason);

	const total = values.reduce((sum, value) => sum + value, 0);
	return Number.isFinite(total)
		? available(total, timestampFor(result))
		: unavailable(reason);
}

function latestMetric(
	results: MetricDataResult[],
	id: string,
	reason: string,
): MetricValue {
	const result = findResult(results, id);
	const values = result?.Values ?? [];
	const timestamps = result?.Timestamps ?? [];
	if (!values.length || !timestamps.length) return unavailable(reason);
	const latestIndex = timestamps.reduce(
		(currentIndex, timestamp, index) => {
			const currentTimestamp = timestamps[currentIndex];
			return currentTimestamp && timestamp > currentTimestamp ? index : currentIndex;
		},
		0,
	);
	const value = values[latestIndex];
	if (value === undefined || !Number.isFinite(value)) return unavailable(reason);
	return available(value, timestamps[latestIndex]?.toISOString() ?? null);
}

function weightedAverage(
	results: MetricDataResult[],
	averageId: string,
	sampleCountId: string,
	reason: string,
): MetricValue {
	const averages = findResult(results, averageId);
	const sampleCounts = findResult(results, sampleCountId);
	if (!averages || !sampleCounts) return unavailable(reason);

	const countsByTimestamp = new Map(
		(sampleCounts.Timestamps ?? []).map((timestamp, index) => [
			timestamp.getTime(),
			sampleCounts.Values?.[index],
		]),
	);
	let weightedTotal = 0;
	let totalSamples = 0;
	let latestSampleTimestamp: Date | undefined;
	const averageTimestamps = averages.Timestamps ?? [];
	for (const [index, timestamp] of averageTimestamps.entries()) {
		const average = averages.Values?.[index];
		const sampleCount = countsByTimestamp.get(timestamp.getTime());
		if (
			average !== undefined &&
			sampleCount !== undefined &&
			Number.isFinite(average) &&
			Number.isFinite(sampleCount) &&
			sampleCount > 0
		) {
			weightedTotal += average * sampleCount;
			totalSamples += sampleCount;
			if (!latestSampleTimestamp || timestamp > latestSampleTimestamp) {
				latestSampleTimestamp = timestamp;
			}
		}
	}

	return totalSamples
		? available(weightedTotal / totalSamples, latestSampleTimestamp?.toISOString() ?? null)
		: unavailable(reason);
}

function dataHours(result: MetricDataResult | undefined): Set<string> {
	return new Set(
		(result?.Timestamps ?? []).map((timestamp) => timestamp.toISOString().slice(0, 13)),
	);
}

function makeErrorBudgetWindow(now: Date) {
	const end = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000);
	const start = new Date(end.getTime() - errorBudgetHours * 3_600_000);
	const expectedHours = Array.from({ length: errorBudgetHours }, (_, index) =>
		new Date(start.getTime() + index * 3_600_000).toISOString(),
	);
	return { start, end, expectedHours };
}

function createMetricSpec(
	id: string,
	namespace: string,
	name: string,
	dimensions: MetricSpec['dimensions'],
	stat: string,
	period: number,
): MetricSpec {
	return { id, namespace, name, dimensions, stat, period };
}

function periodForHours(hours: number): number {
	const minimumPeriod = Math.ceil((hours * 3_600) / 1_440 / 60) * 60;
	return [60, 120, 180, 300, 360, 600, 900, 1_200, 1_800, 3_600]
		.find((period) => period >= minimumPeriod) ?? 3_600;
}

function createWindowQueries(
	configuration: ReliabilityConfiguration,
	hours: number,
	period: number,
): MetricSpec[] {
	const apiDimensions = [
		{ Name: 'ApiId', Value: configuration.apiId },
		{ Name: 'Stage', Value: configuration.stage },
	];
	const queries = [
		createMetricSpec('api_requests', 'AWS/ApiGateway', 'Count', apiDimensions, 'Sum', period),
		createMetricSpec('api_4xx', 'AWS/ApiGateway', '4xx', apiDimensions, 'Sum', period),
		createMetricSpec('api_5xx', 'AWS/ApiGateway', '5xx', apiDimensions, 'Sum', period),
		createMetricSpec('api_latency_average', 'AWS/ApiGateway', 'Latency', apiDimensions, 'Average', period),
		createMetricSpec('api_latency_samples', 'AWS/ApiGateway', 'Latency', apiDimensions, 'SampleCount', period),
	];

	const percentilePeriod = hours > 336 ? 300 : 60;
	queries.push(
		createMetricSpec(
			'api_latency_p50',
			'AWS/ApiGateway',
			'Latency',
			apiDimensions,
			'p50',
			percentilePeriod,
		),
		createMetricSpec(
			'api_latency_p95',
			'AWS/ApiGateway',
			'Latency',
			apiDimensions,
			'p95',
			percentilePeriod,
		),
	);

	for (const { functionName } of lambdaFunctions) {
		const dimensions = [{ Name: 'FunctionName', Value: functionName }];
		queries.push(
			createMetricSpec(`${functionName.replaceAll('-', '_')}_invocations`, 'AWS/Lambda', 'Invocations', dimensions, 'Sum', period),
			createMetricSpec(`${functionName.replaceAll('-', '_')}_errors`, 'AWS/Lambda', 'Errors', dimensions, 'Sum', period),
			createMetricSpec(`${functionName.replaceAll('-', '_')}_throttles`, 'AWS/Lambda', 'Throttles', dimensions, 'Sum', period),
			createMetricSpec(`${functionName.replaceAll('-', '_')}_duration_average`, 'AWS/Lambda', 'Duration', dimensions, 'Average', period),
			createMetricSpec(`${functionName.replaceAll('-', '_')}_duration_samples`, 'AWS/Lambda', 'Duration', dimensions, 'SampleCount', period),
		);
	}

	return queries;
}

function makeErrorBudget(
	results: MetricDataResult[],
	configuration: ReliabilityConfiguration,
	budgetWindow: ReturnType<typeof makeErrorBudgetWindow>,
): ReliabilityResponse['errorBudget'] {
	const requestResult = findResult(results, 'budget_requests');
	const errorResult = findResult(results, 'budget_errors');
	const requests = dataHours(requestResult);
	const errors = dataHours(errorResult);
	const requestHours = budgetWindow.expectedHours.filter((hour) =>
		requests.has(hour.slice(0, 13)),
	).length;
	const errorHours = budgetWindow.expectedHours.filter((hour) =>
		errors.has(hour.slice(0, 13)),
	).length;
	const requestCount = sumMetric(
		results,
		'budget_requests',
		'Complete 30-day request data is unavailable.',
	);
	const errorCount = sumMetric(
		results,
		'budget_errors',
		'Complete 30-day server-error data is unavailable.',
	);
	const coverage = {
		expectedHours: errorBudgetHours,
		requestHours,
		serverErrorHours: errorHours,
	};

	if (requestHours !== errorBudgetHours || errorHours !== errorBudgetHours) {
		return {
			status: 'unavailable',
			target: configuration.availabilityTarget,
			periodHours: errorBudgetHours,
			requestCount,
			serverErrorCount: errorCount,
			coverage,
			reason: 'CloudWatch has not returned data for every hour in both 30-day series.',
		};
	}

	if (
		requestCount.value === null ||
		requestCount.value <= 0 ||
		errorCount.value === null ||
		errorCount.value > requestCount.value
	) {
		return {
			status: 'unavailable',
			target: configuration.availabilityTarget,
			periodHours: errorBudgetHours,
			requestCount,
			serverErrorCount: errorCount,
			coverage,
			reason: 'The 30-day request and server-error totals are missing or inconsistent.',
		};
	}

	const allowedErrors = Number(
		(requestCount.value * (1 - configuration.availabilityTarget)).toPrecision(12),
	);
	if (allowedErrors === 0) {
		return {
			status: 'unavailable',
			target: configuration.availabilityTarget,
			periodHours: errorBudgetHours,
			requestCount,
			serverErrorCount: errorCount,
			coverage,
			reason: 'A 100% availability objective allows no errors, so percentage budget consumption is undefined.',
		};
	}
	const consumedPercent = allowedErrors > 0
		? Number(((errorCount.value / allowedErrors) * 100).toFixed(4))
		: null;

	return {
		status: 'available',
		target: configuration.availabilityTarget,
		periodHours: errorBudgetHours,
		requestCount,
		serverErrorCount: errorCount,
		allowedServerErrors: allowedErrors,
		consumedPercent: consumedPercent === null
			? unavailable('The configured SLO allows no errors.')
			: available(consumedPercent, timestampFor(requestResult)),
		remainingPercent: consumedPercent === null
			? unavailable('The configured SLO allows no errors.')
			: available(Math.max(0, 100 - consumedPercent), timestampFor(requestResult)),
		coverage,
	};
}

function isThrottleError(error: unknown): boolean {
	if (typeof error !== 'object' || error === null) return false;
	const name = (error as { name?: unknown }).name;
	return name === 'ThrottlingException' || name === 'TooManyRequestsException';
}

function hasIncompleteResults(results: MetricDataResult[]): boolean {
	return results.some((result) => result.StatusCode !== 'Complete');
}

export function createReliabilityHandler(dependencies: HandlerDependencies = {}) {
	const environment = dependencies.environment ?? process.env;
	const cloudWatch = new CloudWatchClient({
		region: environment.AWS_REGION ?? 'eu-west-1',
	});
	const getMetricData = dependencies.getMetricData ?? ((input) =>
		cloudWatch.send(new GetMetricDataCommand(input)));
	const now = dependencies.now ?? (() => new Date());

	return async function handler(event: HttpApiEvent): Promise<HttpApiResponse> {
		const parameters = event.queryStringParameters ?? {};
		if (Object.keys(parameters).some((key) => key !== 'hours')) {
			return jsonResponse({
				status: 'error',
				error: 'Only the hours parameter is supported.',
			}, 400);
		}

		const hours = parseHours(parameters.hours);
		if (hours === undefined) {
			return jsonResponse({
				status: 'error',
				error: `Hours must be a whole number from 1 to ${maximumWindowHours}.`,
			}, 400);
		}

		const configuration = parseConfiguration(environment);
		if (!configuration) {
			return jsonResponse({
				status: 'error',
				error: 'Reliability metrics are not configured.',
			}, 503);
		}

		const generatedAt = now();
		const period = periodForHours(hours);
		const periodMilliseconds = period * 1_000;
		const windowEnd = new Date(
			Math.floor(generatedAt.getTime() / periodMilliseconds) * periodMilliseconds,
		);
		const windowStart = new Date(windowEnd.getTime() - hours * 60 * 60 * 1000);
		const budgetWindow = makeErrorBudgetWindow(generatedAt);
		const queries = createWindowQueries(configuration, hours, period);
		const budgetQueries = [
			createMetricSpec(
				'budget_requests',
				'AWS/ApiGateway',
				'Count',
				[
					{ Name: 'ApiId', Value: configuration.apiId },
					{ Name: 'Stage', Value: configuration.stage },
				],
				'Sum',
				3_600,
			),
			createMetricSpec(
				'budget_errors',
				'AWS/ApiGateway',
				'5xx',
				[
					{ Name: 'ApiId', Value: configuration.apiId },
					{ Name: 'Stage', Value: configuration.stage },
				],
				'Sum',
				3_600,
			),
		];

		let results: MetricDataResult[];
		let budgetResults: MetricDataResult[];
		try {
			const [windowResponse, budgetResponse] = await Promise.all([
				getMetricData({
					StartTime: windowStart,
					EndTime: windowEnd,
					MetricDataQueries: queries.map(metricQuery),
					MaxDatapoints: 100_800,
				}),
				getMetricData({
					StartTime: budgetWindow.start,
					EndTime: budgetWindow.end,
					MetricDataQueries: budgetQueries.map(metricQuery),
					MaxDatapoints: 1_440,
				}),
			]);
			results = windowResponse.MetricDataResults ?? [];
			budgetResults = budgetResponse.MetricDataResults ?? [];
			if (hasIncompleteResults(results) || hasIncompleteResults(budgetResults)) {
				throw new IncompleteMetricResultsError();
			}
		} catch (error) {
			const throttled = isThrottleError(error);
			console.error(JSON.stringify({
				level: 'error',
				event: error instanceof IncompleteMetricResultsError
					? 'reliability.cloudwatch_incomplete_results'
					: 'reliability.cloudwatch_query_failed',
				errorType: error instanceof Error ? error.name : 'UnknownError',
			}));
			return jsonResponse({
				status: 'error',
				error: throttled
					? 'CloudWatch is temporarily throttling reliability metrics.'
					: error instanceof IncompleteMetricResultsError
						? 'CloudWatch returned incomplete reliability metrics.'
						: 'Reliability metrics are temporarily unavailable.',
			}, throttled ? 503 : 502);
		}

		const apiRequestCount = sumMetric(
			results,
			'api_requests',
			'No API request data was returned for this window.',
		);
		const apiClientErrorCount = sumMetric(
			results,
			'api_4xx',
			'API client-error data is unavailable.',
		);
		const apiServerErrorCount = sumMetric(
			results,
			'api_5xx',
			'API server-error data is unavailable.',
		);
		let apiErrorRate = unavailable('Request and server-error metrics are both required.');
		if (apiRequestCount.value !== null && apiServerErrorCount.value !== null) {
			if (apiRequestCount.value <= 0) {
				apiErrorRate = unavailable('A positive API request denominator is required.');
			} else if (apiServerErrorCount.value > apiRequestCount.value) {
				apiErrorRate = unavailable('The API request and server-error metrics are inconsistent.');
			} else {
				apiErrorRate = available(
					apiServerErrorCount.value / apiRequestCount.value,
					apiServerErrorCount.timestamp,
				);
			}
		}
		const apiAvailability = apiErrorRate.value === null
			? unavailable(apiErrorRate.reason ?? 'Availability data is unavailable.')
			: available(1 - apiErrorRate.value, apiErrorRate.timestamp);
		const percentilePeriodSeconds = hours > 336 ? 300 : 60;
		const apiLatency = {
			average: weightedAverage(
				results,
				'api_latency_average',
				'api_latency_samples',
				'API Gateway average latency data is unavailable.',
			),
			p50: latestMetric(
				results,
				'api_latency_p50',
				'No API Gateway p50 latency data was returned.',
			),
			p95: latestMetric(
				results,
				'api_latency_p95',
				'No API Gateway p95 latency data was returned.',
			),
			percentilePeriodSeconds,
		};

		const lambdaMetrics = lambdaFunctions.map(({ functionName, name }) => {
			const queryPrefix = functionName.replaceAll('-', '_');
			return {
				name,
				functionName,
				invocations: sumMetric(
					results,
					`${queryPrefix}_invocations`,
					'No invocation data was returned for this window.',
				),
				errors: sumMetric(
					results,
					`${queryPrefix}_errors`,
					'Lambda error data is unavailable.',
				),
				throttles: sumMetric(
					results,
					`${queryPrefix}_throttles`,
					'Lambda throttle data is unavailable.',
				),
				durationAverageMs: weightedAverage(
					results,
					`${queryPrefix}_duration_average`,
					`${queryPrefix}_duration_samples`,
					'Lambda duration data is unavailable.',
				),
			};
		});

		const reliabilityResponse: ReliabilityResponse = {
			schemaVersion: 1,
			generatedAt: generatedAt.toISOString(),
			window: {
				start: windowStart.toISOString(),
				end: windowEnd.toISOString(),
				hours,
			},
			objectives: {
				availability: configuration.availabilityTarget,
				apiLatencyP95Ms: configuration.apiLatencyP95TargetMs,
			},
			metrics: {
				apiGateway: {
					requestCount: apiRequestCount,
					clientErrorCount: apiClientErrorCount,
					serverErrorCount: apiServerErrorCount,
					serverErrorRate: apiErrorRate,
					latencyMs: apiLatency,
				},
				lambda: lambdaMetrics,
			},
			slis: {
				availability: {
					value: apiAvailability,
					target: configuration.availabilityTarget,
					numerator: apiServerErrorCount,
					denominator: apiRequestCount,
					errorClassification: 'API Gateway HTTP 5xx responses',
				},
				apiLatencyP95: {
					value: apiLatency.p95,
					targetMs: configuration.apiLatencyP95TargetMs,
				},
			},
			errorBudget: makeErrorBudget(budgetResults, configuration, budgetWindow),
		};
		return jsonResponse(reliabilityResponse, 200);
	};
}

export const handler = createReliabilityHandler();
