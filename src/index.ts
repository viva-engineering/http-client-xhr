
import { logger } from '@viva-eng/logger-web';
import { HttpTimer, TimerResult } from './timer';
import { ReadyState } from './readystate';
import { IsRetryableCallback, retryNetworkErrors, XhrFailures } from './retryable';

export { IsRetryableCallback, XhrFailures } from './retryable';

let nextRequestId: number = 1;

const enum Outcome {
	None = 0,
	Done = 1,
	Error = 2,
	Abort = 3,
	Timeout = 4
}

interface Headers {
	[header: string]: string;
}

export interface HttpClientParams {
	hostname: string;
	port: number;
	ssl: boolean;
	headers?: Headers;
	timeout?: number;
	retries?: number;
	isRetryable?: IsRetryableCallback;
	slowThreshold?: number;
}

export interface HttpRequestOptions {
	body?: string | Document | Blob | ArrayBufferView | ArrayBuffer | FormData | URLSearchParams | ReadableStream<Uint8Array>;
	headers?: Headers;
	timeout?: number;
	retries?: number;
	isRetryable?: IsRetryableCallback;
	slowThreshold?: number;
	responseType?: '' | 'arraybuffer' | 'blob'
}

export interface Response {
	xhr: XMLHttpRequest;
	statusCode: number;
	headers: Headers;
	rawHeaders: [ string, string ][];
	body: string | ArrayBuffer | Blob;
	json?: any
}

export class HttpClient {
	public readonly hostname: string;
	public readonly port: number;
	public readonly headers?: Headers;
	public readonly ssl: boolean;
	public readonly timeout: number;
	public readonly retries: number;
	public readonly isRetryable: IsRetryableCallback;
	public readonly slowThreshold: number;

	constructor(params: HttpClientParams) {
		this.hostname = params.hostname;
		this.port = params.port;
		this.ssl = params.ssl;
		this.headers = params.headers || { };
		this.timeout = params.timeout || 0;
		this.retries = params.retries || 0;
		this.isRetryable = params.isRetryable || retryNetworkErrors;
		this.slowThreshold = params.slowThreshold || 200;
	}

	toString() {
		return `#<HttpClient host=${this.hostname} port=${this.port} ssl=${this.ssl}>`;
	}

	request(method: string, path: string, params: HttpRequestOptions) : Promise<Response> {
		return this._makeRequest(method, path, params);
	}

	get(path: string, params: HttpRequestOptions) : Promise<Response> {
		return this._makeRequest('GET', path, params);
	}

	post(path: string, params: HttpRequestOptions) : Promise<Response> {
		return this._makeRequest('POST', path, params);
	}

	put(path: string, params: HttpRequestOptions) : Promise<Response> {
		return this._makeRequest('PUT', path, params);
	}

	patch(path: string, params: HttpRequestOptions) : Promise<Response> {
		return this._makeRequest('PATCH', path, params);
	}

	delete(path: string, params: HttpRequestOptions) : Promise<Response> {
		return this._makeRequest('DELETE', path, params);
	}

	protected _makeRequest(method: string, path: string, params: HttpRequestOptions, attempt: number = 1) : Promise<Response> {
		const requestId = nextRequestId++;

		if (requestId >= Number.MAX_SAFE_INTEGER) {
			nextRequestId = 1;
		}

		const xhr = new XMLHttpRequest();

		if (params.responseType) {
			xhr.responseType = params.responseType;
		}

		return new Promise((resolve, reject) => {
			const timer = new HttpTimer(xhr, params.slowThreshold || this.slowThreshold);
			const timeout = params.timeout == null ? this.timeout : params.timeout;

			logger.verbose('Starting outgoing HTTP request', {
				requestId,
				attempt,
				hostname: this.hostname,
				port: this.port,
				ssl: this.ssl,
				method: method,
				path: path,
				timeout: timeout
			});

			if (timeout) {
				xhr.timeout = timeout;
			}

			const onReadyStateChange = (event: Event) => {
				switch (xhr.readyState) {
					case ReadyState.Unsent:
						// 
						break;

					case ReadyState.Opened:
						// 
						break;

					case ReadyState.HeadersReceived:
						// 
						break;

					case ReadyState.Loading:
						// 
						break;

					case ReadyState.Done:
						// We set a small delay before handling the completion to wait and see if a
						// timeout, abort, or error event is coming
						setTimeout(onDone, 10);
						break;
				}
			};

			let outcome: Outcome = Outcome.None;

			const onError = (event: ProgressEvent) => {
				logger.warn('An error occured while trying to make an HTTP request', { requestId });

				retryIfPossible(xhr, XhrFailures.Error);
			};

			const onAbort = (event: ProgressEvent) => {
				logger.warn('Outgoing HTTP request was aborted', { requestId });

				retryIfPossible(xhr, XhrFailures.Abort);
			};

			const onTimeout = (event: ProgressEvent) => {
				logger.warn('Outgoing HTTP request timed out', { requestId });

				retryIfPossible(xhr, XhrFailures.Timeout);
			};

			const onDone = () => {
				if (outcome !== Outcome.None) {
					return;
				}

				outcome = Outcome.Done;

				const data: string | ArrayBuffer | Blob = xhr.response || xhr.responseText;
				// This is technically not accurate for string data, but I don't want to waste
				// performance converting to a buffer just to pull length for logs that will be
				// disabled in production
				const contentLength = (data instanceof Blob)
					? data.size
					: (data instanceof ArrayBuffer)
						? data.byteLength
						: data.length;

				const durations = timer.durations();
				const logLevel = durations.wasSlow ? 'warn' : 'verbose';

				logger[logLevel]('Outbound HTTP request complete', {
					requestId,
					hostname: this.hostname,
					port: this.port,
					method: method,
					path: path,
					status: xhr.status,
					contentLength,
					...durations
				});

				const res: Response = {
					xhr,
					statusCode: xhr.status,
					body: data,
					headers: { },
					rawHeaders: [ ]
				};

				const headers = xhr.getAllResponseHeaders().trim().split('\r\n');

				headers.forEach((header) => {
					const nameEndIndex = header.indexOf(':');
					const name = header.slice(0, nameEndIndex).trim();
					const value = header.slice(nameEndIndex + 1).trim();

					res.headers[name.toLowerCase()] = value;
					res.rawHeaders.push([ name, value ]);
				});

				if (res.headers['content-type'] === 'application/json' && xhr.responseType) {
					try {
						res.json = JSON.parse(data as string);
					}

					catch (error) {
						logger.warn('HTTP response content-type was application/json, but the payload was unparsable', { requestId });
					}
				}

				if (res.statusCode >= 400) {
					retryIfPossible(xhr, XhrFailures.Status, res);
				}

				else {
					resolve(res);
				}
			};

			xhr.addEventListener('readystatechange', onReadyStateChange);
			xhr.addEventListener('error', onError);
			xhr.addEventListener('abort', onAbort);
			xhr.addEventListener('timeout', onTimeout);

			const scheme = this.ssl ? 'https://' : 'http://';
			const url = `${scheme}${this.hostname}:${this.port}${path}`;

			xhr.open(method, url);

			const headers = {
				...this.headers,
				...(params.headers || { })
			};

			Object.keys(headers).forEach((header) => {
				xhr.setRequestHeader(header, headers[header]);
			});

			const isRetryable = params.isRetryable == null ? this.isRetryable : params.isRetryable;

			const retryIfPossible = (xhr: XMLHttpRequest, cause: XhrFailures, res?: Response) => {
				const retries = params.retries == null ? this.retries : params.retries;
	
				if (retries) {
					if (isRetryable(xhr, cause, res)) {
						const newParams = Object.assign({ }, params);

						newParams.retries = retries - 1;

						const backoff = (2 ** attempt) * 250;
						const doRetry = () => {
							this._makeRequest(method, path, newParams).then(resolve, reject);
						};

						setTimeout(doRetry, backoff);

						return;
					}
				}

				const durations = timer.durations();

				logger.verbose('Outbound HTTP request failed', {
					requestId,
					attempt,
					hostname: this.hostname,
					port: this.port,
					ssl: this.ssl,
					method: method,
					path: path,
					...durations
				});

				reject({ xhr, cause });
			};

			if (params.body && method !== 'GET' && method !== 'HEAD') {
				xhr.send(params.body)
			}
		});
	}
}
