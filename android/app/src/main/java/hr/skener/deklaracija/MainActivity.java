package hr.skener.deklaracija;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Lokalni dodaci (iz ovog projekta) registriraju se prije pokretanja Capacitora.
        registerPlugin(TextRecognitionPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
