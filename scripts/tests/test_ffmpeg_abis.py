import contextlib
import importlib.util
import io
from pathlib import Path
import struct
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('ffmpeg_abis', ROOT / 'scripts/check-ffmpeg-abis.py')
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


def elf(abi):
    data = bytearray(64)
    data[:4] = b'\x7fELF'
    data[4], machine = checker.ABI[abi]
    data[5] = 1
    struct.pack_into('<H', data, 18, machine)
    return data


class FfmpegPackagingTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='vega-ffmpeg-abi-')
        self.root = Path(self.directory.name)

    def tearDown(self):
        self.directory.cleanup()

    def write_archive(self, extension, abis, omit=None, wrong_arch=False):
        path = self.root / f'app.{extension}'
        with zipfile.ZipFile(path, 'w') as archive:
            for abi in abis:
                for name in checker.LIBRARIES:
                    if (abi, name) == omit:
                        continue
                    prefix = 'base/lib' if extension == 'aab' else 'lib'
                    archive.writestr(f'{prefix}/{abi}/{name}',
                                     elf('arm64-v8a' if wrong_arch else abi))
        return path

    def verify(self, source, abis=None):
        with contextlib.redirect_stdout(io.StringIO()):
            checker.verify(source, abis or list(checker.ABI))

    def test_complete_universal_apk(self):
        self.verify(self.write_archive('apk', checker.ABI))

    def test_complete_play_store_bundle(self):
        self.verify(self.write_archive('aab', checker.ABI))

    def test_missing_armv7_reproduces_532_packaging_failure(self):
        with self.assertRaises(KeyError):
            self.verify(self.write_archive('apk', ['arm64-v8a']))

    def test_missing_abi_detector_fails(self):
        with self.assertRaises(KeyError):
            self.verify(self.write_archive('apk', checker.ABI,
                        omit=('armeabi-v7a', 'libffmpegkit_abidetect.so')))

    def test_rejects_arm64_library_in_armv7_directory(self):
        with self.assertRaises(ValueError):
            self.verify(self.write_archive('apk', checker.ABI, wrong_arch=True))

    def test_source_build_directory(self):
        for library in checker.LIBRARIES:
            path = self.root / 'armeabi-v7a' / library
            path.parent.mkdir(exist_ok=True)
            path.write_bytes(elf('armeabi-v7a'))
        self.verify(self.root, ['armeabi-v7a'])

    def test_rejects_truncated_or_non_elf_artifact(self):
        for library in checker.LIBRARIES:
            path = self.root / 'armeabi-v7a' / library
            path.parent.mkdir(exist_ok=True)
            path.write_bytes(b'not ELF')
        with self.assertRaises(ValueError):
            self.verify(self.root, ['armeabi-v7a'])


if __name__ == '__main__':
    unittest.main()
