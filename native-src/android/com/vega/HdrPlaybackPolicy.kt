package com.vega

/** Brightness ratio alone and source metadata alone cannot establish HDR output. */
internal object HdrPlaybackPolicy {
    fun supportsDolbyProfile(profile: Int?, advertisedProfiles: Set<Int>?): Boolean =
        profile != null && advertisedProfiles?.contains(profile) == true

    fun sameTrack(sourceMime: String?, frameMime: String?, sourceWidth: Int, frameWidth: Int,
        sourceHeight: Int, frameHeight: Int): Boolean =
        sourceMime != null && sourceMime == frameMime && sourceWidth == frameWidth && sourceHeight == frameHeight

    fun dolbyDecoderActive(dolbySource: Boolean, dolbyDisplay: Boolean, decoderSupportsDolby: Boolean,
        hardware: Boolean, renderedOutput: Boolean): Boolean =
        dolbySource && dolbyDisplay && hardware && renderedOutput &&
            decoderSupportsDolby

    fun hasHdrEvidence(outputTransfer: Int?, sourceTransfer: Int?, renderedOutput: Boolean,
        displaySupportsHdr: Boolean, dolbyDecoderActive: Boolean, headroom: Double?): Boolean {
        if (!displaySupportsHdr || !renderedOutput) return false
        if (dolbyDecoderActive) return true
        // Explicit SDR decoder output always overrides HDR source metadata.
        if (outputTransfer != null) return outputTransfer == 6 || outputTransfer == 7
        // Missing frame callbacks need independent display evidence as well as
        // HDR source metadata and counters proving frames were actually presented.
        return (sourceTransfer == 6 || sourceTransfer == 7) &&
            headroom != null && headroom.isFinite() && headroom > 1.01
    }
}
