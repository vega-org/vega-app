package com.vega;

/** Bound EBML sizes while they are still longs, before calculating array offsets. */
public final class EbmlBounds {
    private EbmlBounds() {}

    public static int end(int offset, long size, int limit) {
        if (offset < 0 || limit < offset || size < 0) {
            throw new IllegalArgumentException("Invalid EBML element bounds");
        }
        return offset + (int) Math.min(size, (long) limit - offset);
    }
}
