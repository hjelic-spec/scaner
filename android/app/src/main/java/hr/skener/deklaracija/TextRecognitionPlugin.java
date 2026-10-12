package hr.skener.deklaracija;

import android.net.Uri;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

/**
 * Prepoznavanje teksta na uređaju pomoću Google ML Kita (latinično pismo, uključujući hrvatske
 * dijakritike). Model je ugrađen u aplikaciju, pa radi bez interneta i ništa ne šalje na poslužitelj.
 *
 * JavaScript: Capacitor.registerPlugin('TextRecognition').recognize({ uri }) → { text }
 */
@CapacitorPlugin(name = "TextRecognition")
public class TextRecognitionPlugin extends Plugin {

    private TextRecognizer recognizer;

    @Override
    public void load() {
        recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
    }

    @PluginMethod
    public void recognize(PluginCall call) {
        String uri = call.getString("uri");
        if (uri == null || uri.isEmpty()) {
            call.reject("Nedostaje putanja do fotografije.");
            return;
        }

        InputImage image;
        try {
            image = InputImage.fromFilePath(getContext(), Uri.parse(uri));
        } catch (Exception e) {
            call.reject("Fotografija se ne može otvoriti: " + e.getMessage(), e);
            return;
        }

        recognizer
            .process(image)
            .addOnSuccessListener(result -> {
                // Retci jednog bloka odvajaju se novim retkom; blokovi također (bez praznog retka),
                // kako se odlomak sastojaka razlomljen u više blokova ne bi prekinuo.
                StringBuilder sb = new StringBuilder();
                for (Text.TextBlock block : result.getTextBlocks()) {
                    for (Text.Line line : block.getLines()) {
                        sb.append(line.getText()).append('\n');
                    }
                }
                JSObject ret = new JSObject();
                ret.put("text", sb.toString().trim());
                call.resolve(ret);
            })
            .addOnFailureListener(e -> call.reject("Prepoznavanje teksta nije uspjelo: " + e.getMessage(), e));
    }

    @Override
    protected void handleOnDestroy() {
        if (recognizer != null) {
            recognizer.close();
        }
    }
}
