"""Fail release validation if an ARM ABI lacks FFmpegKit or has the wrong ELF ABI."""
import argparse
from pathlib import Path
import struct
import zipfile

LIBRARIES = (
    'libffmpegkit.so', 'libffmpegkit_abidetect.so', 'libavcodec.so',
    'libavformat.so', 'libavutil.so', 'libavfilter.so', 'libavdevice.so',
    'libswresample.so', 'libswscale.so',
)
ABI = {'armeabi-v7a': (1, 40), 'arm64-v8a': (2, 183)}


def verify(source, abis):
    source = Path(source)
    archive = zipfile.ZipFile(source) if source.is_file() else None
    try:
        for abi in abis:
            for library in LIBRARIES:
                if archive:
                    prefix = 'base/lib' if source.suffix == '.aab' else 'lib'
                    with archive.open(f'{prefix}/{abi}/{library}') as stream:
                        data = stream.read(20)
                else:
                    with (source / abi / library).open('rb') as stream:
                        data = stream.read(20)
                elf_class, machine = ABI[abi]
                if (len(data) < 20 or data[:4] != b'\x7fELF' or
                        data[4] != elf_class or data[5] != 1 or
                        struct.unpack_from('<H', data, 18)[0] != machine):
                    raise ValueError(f'Invalid ELF architecture: {abi}/{library}')
            print(f'FFmpegKit verified: {abi} ({len(LIBRARIES)} libraries)')
    finally:
        if archive:
            archive.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', help='JNI directory, APK, or AAB')
    parser.add_argument('--abis', nargs='+', choices=ABI, default=list(ABI))
    args = parser.parse_args()
    verify(args.source, args.abis)
