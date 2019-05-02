
import { ReadyState } from './readystate';

export interface TimerResult {
	duration?: string;
	headersReceived?: string;
	contentDownload?: string;
	wasSlow?: boolean;
}

const oneMinute = 60;
const oneHour = 60 * 60;

export class HttpTimer {
	protected opened: number;
	protected headersReceived: number;
	protected done: number;

	constructor(
		protected readonly xhr: XMLHttpRequest,
		protected readonly slowThreshold: number
	) {
		this.xhr.addEventListener('readystatechange', (event) => {
			switch (this.xhr.readyState) {
				case ReadyState.Unsent:
					// skip
					break;

				case ReadyState.Opened:
					this.opened = event.timeStamp;
					break;

				case ReadyState.HeadersReceived:
					this.headersReceived = event.timeStamp;
					break;

				case ReadyState.Loading:
					// skip
					break;

				case ReadyState.Done:
					this.done = event.timeStamp;
					break;
			}
		});
	}

	durations() : TimerResult {
		const result: TimerResult = { };
		const duration = this.done - this.opened;

		result.duration = formatDuration(duration);

		if (this.opened && this.headersReceived) {
			result.headersReceived = formatDuration(this.headersReceived - this.opened);
		}

		if (this.headersReceived && this.done) {
			result.contentDownload = formatDuration(this.done - this.headersReceived);
		}

		result.wasSlow = duration > this.slowThreshold;

		return result;
	}
}

/**
 * Returns a formatted duration string from a `process.hrtime()` result. Output can look like
 * "4.56789ms", "3sec 4.56789ms", "2min 3sec 4.56789ms", or "1hr 2min 3sec 4.56789ms"
 */
export const formatDuration = (rawMilliseconds: number) : string => {
	const wholeSeconds = ((rawMilliseconds | 0) / 1000) | 0;
	const milliseconds = `${(rawMilliseconds - wholeSeconds * 1000).toPrecision(6)}ms`;

	if (wholeSeconds < 1) {
		return milliseconds;
	}

	if (wholeSeconds < oneMinute) {
		return `${wholeSeconds}sec ${milliseconds}`;
	}

	if (wholeSeconds < oneHour) {
		const minutes = (wholeSeconds / oneMinute) | 0;
		const remainingSeconds = wholeSeconds % oneMinute;

		return `${minutes}min ${remainingSeconds}sec ${milliseconds}`;
	}

	const hours = (wholeSeconds / oneHour) | 0;
	const remainingMinutes = (wholeSeconds % oneHour / oneMinute) | 0;
	const remainingSeconds = (wholeSeconds % oneHour % oneMinute) | 0;

	return `${hours}hr ${remainingMinutes}min ${remainingSeconds}sec ${milliseconds}`;
};
