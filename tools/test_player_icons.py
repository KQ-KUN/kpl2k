"""Portrait cache works without a legacy Guessing checkout."""
import json
from pathlib import Path
import unittest
import uuid
from unittest.mock import patch
from tools import player_icons

class PortraitTest(unittest.TestCase):
    def fixture(self):
        root=Path(__file__).resolve().parents[1]/'output'/('portrait-'+uuid.uuid4().hex)
        (root/'app/assets/player-icons').mkdir(parents=True);(root/'data/processed').mkdir(parents=True)
        return root
    def test_canonical_cache_without_guessing(self):
        root=self.fixture();(root/'app/assets/player-icons/a.webp').write_bytes(b'fixture')
        cache=root/'data/processed/player_icon_cache.json';cache.write_text(json.dumps({'icons':{'A':'assets/player-icons/a.webp','missing':'assets/player-icons/missing.webp','unsafe':'../outside.webp'}}),encoding='utf-8')
        with patch.multiple(player_icons,ROOT=root,KPL_CACHE=cache,APP_ASSETS=root/'app/assets/player-icons'):
            self.assertEqual(player_icons.sync_player_icon_cache(),{'A':'assets/player-icons/a.webp'})
        self.assertFalse((root/'guessing').exists())
    def test_explicit_asset_input_preserves_identity_and_rejects_collisions(self):
        root=self.fixture();assets=root/'supplied';assets.mkdir();(assets/'a.webp').write_bytes(b'first')
        source=root/'source.json';source.write_text(json.dumps({'players':[{'id':'A@T','icon':'assets/player-icons/a.webp'},{'id':'B@T','icon':'https://example.invalid/x.png'}]}),encoding='utf-8')
        with patch.multiple(player_icons,ROOT=root,KPL_CACHE=root/'none.json',APP_ASSETS=root/'app/assets/player-icons'):
            self.assertEqual(player_icons.sync_player_icon_cache(source,assets),{'A':'assets/player-icons/a.webp'})
            (assets/'a.webp').write_bytes(b'different')
            with self.assertRaises(ValueError):player_icons.sync_player_icon_cache(source,assets)
if __name__=='__main__':unittest.main()
