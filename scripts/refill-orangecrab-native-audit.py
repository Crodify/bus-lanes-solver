import sys
from pathlib import Path

import pcbnew
import wx

application = wx.App(False)
for sample in ["baseline", "rerouted"]:
    board_path = Path("work/native-audit/native") / sample / "OrangeCrab.kicad_pcb"
    print(f"Loading {sample}", flush=True)
    board = pcbnew.LoadBoard(str(board_path))
    assert board is not None
    print(f"Building connectivity for {sample}", flush=True)
    board.BuildConnectivity()
    print(f"Refilling {sample}: {len(board.Zones())} authored zones", flush=True)
    filler = pcbnew.ZONE_FILLER(board)
    assert filler.Fill(board.Zones()), f"Native refill failed: {sample}"
    assert pcbnew.SaveBoard(str(board_path), board)
    print(f"Saved freshly refilled {sample}", flush=True)
