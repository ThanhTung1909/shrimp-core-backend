import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class HttpThrottlerGuard extends ThrottlerGuard {
    protected setResponseHeader(
        response: Parameters<ThrottlerGuard['setResponseHeader']>[0],
        name: string,
        value: number,
    ): void {
        const normalizedValue = name.startsWith('Retry-After')
            ? Math.ceil(value / 1000)
            : value;

        super.setResponseHeader(response, name, normalizedValue);
    }
}