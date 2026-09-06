using UdonSharp;
using UnityEngine;
using VRC.SDK3.Image;
using VRC.SDKBase;
using VRC.Udon;

[UdonBehaviourSyncMode(BehaviourSyncMode.None)]
public class HYPNRemotePicture : UdonSharpBehaviour
{
    [Header("HYPN IMAGING SYSTEM - CARTEL PERSISTENTE V1.4.14")]
    [Tooltip("ID del cartel, por ejemplo salon_01.")]
    public string channelId;

    [HideInInspector]
    public int channelIndex;

    [HideInInspector]
    public HYPNRemoteImageManager manager;

    [Header("RENDERERS")]
    [Tooltip("Renderers de este cartel. El Tool los rellena automaticamente.")]
    public Renderer[] targetRenderers;

    [Tooltip("Si no hay Renderers asignados, busca hijos llamados exactamente 'Picture (Do not touch)'.")]
    public bool searchPictureChildrenWhenEmpty = true;

    public string fallbackRendererName = "Picture (Do not touch)";

    [Header("TEXTURAS")]
    public string texturePropertyName = "_MainTex";

    [Tooltip("Tambien coloca la misma imagen en _EmissionMap, igual que el sistema de referencia que funciona.")]
    public bool applyEmission = true;

    public string emissionPropertyName = "_EmissionMap";

    [Tooltip("Si una descarga falla, restaura la textura original. Desactivado por defecto para no quitar una imagen buena por un fallo temporal.")]
    public bool restoreDefaultsOnError = false;

    [Tooltip("Genera mipmaps en la imagen descargada.")]
    public bool generateMipMaps = true;

    [Range(0, 16)]
    public int anisoLevel = 9;

    [HideInInspector]
    public VRCUrl PendingURL;

    [HideInInspector]
    public VRCUrl CurrentURL;

    private VRCImageDownloader _imageDownloader;
    private UdonBehaviour _udonBehaviour;
    private Material[] _runtimeMaterials;
    private Texture[] _defaultTextures;
    private Texture[] _defaultEmissionTextures;
    private IVRCImageDownload _activeDownload;
    private bool _initialized;

    public void InitializePicture()
    {
        if (_initialized)
        {
            return;
        }

        _imageDownloader = new VRCImageDownloader();
        _udonBehaviour = GetComponent<UdonBehaviour>();

        BuildRendererCache();
        _initialized = true;
    }

    private void BuildRendererCache()
    {
        Renderer[] source = targetRenderers;

        if ((source == null || source.Length == 0) &&
            searchPictureChildrenWhenEmpty)
        {
            Renderer[] allRenderers =
                GetComponentsInChildren<Renderer>(true);

            int count = 0;
            for (int i = 0; i < allRenderers.Length; i++)
            {
                if (allRenderers[i] != null &&
                    allRenderers[i].gameObject.name == fallbackRendererName)
                {
                    count++;
                }
            }

            source = new Renderer[count];
            int index = 0;

            for (int i = 0; i < allRenderers.Length; i++)
            {
                if (allRenderers[i] != null &&
                    allRenderers[i].gameObject.name == fallbackRendererName)
                {
                    source[index] = allRenderers[i];
                    index++;
                }
            }

            targetRenderers = source;
        }

        int total = source == null ? 0 : source.Length;

        _runtimeMaterials = new Material[total];
        _defaultTextures = new Texture[total];
        _defaultEmissionTextures = new Texture[total];

        for (int i = 0; i < total; i++)
        {
            Renderer renderer = source[i];

            if (renderer == null)
            {
                continue;
            }

            Material material = renderer.material;
            _runtimeMaterials[i] = material;

            if (material != null)
            {
                _defaultTextures[i] =
                    material.GetTexture(texturePropertyName);

                if (applyEmission)
                {
                    _defaultEmissionTextures[i] =
                        material.GetTexture(emissionPropertyName);
                }
            }
        }
    }

    public void RefreshRenderers()
    {
        BuildRendererCache();
    }

    public void DownloadPendingURL()
    {
        if (!_initialized)
        {
            InitializePicture();
        }

        DownloadImage(PendingURL);
    }

    public void DownloadImage(VRCUrl url)
    {
        if (!_initialized)
        {
            InitializePicture();
        }

        if (VRCUrl.IsNullOrEmpty(url) ||
            _imageDownloader == null ||
            _udonBehaviour == null)
        {
            NotifyFailure();
            return;
        }

        CurrentURL = url;

        TextureInfo info = new TextureInfo();
        info.GenerateMipMaps = generateMipMaps;
        info.AnisoLevel = anisoLevel;

        _imageDownloader.DownloadImage(
            url,
            null,
            _udonBehaviour,
            info
        );
    }

    public override void OnImageLoadSuccess(
        IVRCImageDownload result)
    {
        if (result == null || result.Result == null)
        {
            NotifyFailure();
            return;
        }

        Texture2D texture = result.Result;

        if (_runtimeMaterials == null)
        {
            BuildRendererCache();
        }

        int total =
            _runtimeMaterials == null
                ? 0
                : _runtimeMaterials.Length;

        for (int i = 0; i < total; i++)
        {
            Material material = _runtimeMaterials[i];

            if (material == null)
            {
                continue;
            }

            material.SetTexture(
                texturePropertyName,
                texture
            );

            if (applyEmission)
            {
                material.SetTexture(
                    emissionPropertyName,
                    texture
                );
            }
        }

        IVRCImageDownload previous = _activeDownload;
        _activeDownload = result;

        if (previous != null)
        {
            previous.Dispose();
        }

        if (manager != null)
        {
            manager.SendCustomEvent(
                nameof(HYPNRemoteImageManager.PictureDownloadSucceeded)
            );
        }
    }

    public override void OnImageLoadError(
        IVRCImageDownload result)
    {
        if (restoreDefaultsOnError)
        {
            ForceRestoreDefaults();
        }

        NotifyFailure();
    }

    public void ForceRestoreDefaults()
    {
        if (_runtimeMaterials == null ||
            _defaultTextures == null)
        {
            return;
        }

        for (int i = 0; i < _runtimeMaterials.Length; i++)
        {
            Material material = _runtimeMaterials[i];

            if (material == null)
            {
                continue;
            }

            if (i < _defaultTextures.Length &&
                _defaultTextures[i] != null)
            {
                material.SetTexture(
                    texturePropertyName,
                    _defaultTextures[i]
                );
            }

            if (applyEmission &&
                _defaultEmissionTextures != null &&
                i < _defaultEmissionTextures.Length &&
                _defaultEmissionTextures[i] != null)
            {
                material.SetTexture(
                    emissionPropertyName,
                    _defaultEmissionTextures[i]
                );
            }
        }
    }

    private void NotifyFailure()
    {
        if (manager != null)
        {
            manager.SendCustomEvent(
                nameof(HYPNRemoteImageManager.PictureDownloadFailed)
            );
        }
    }

    private void OnDestroy()
    {
        if (_activeDownload != null)
        {
            _activeDownload.Dispose();
        }

        if (_imageDownloader != null)
        {
            _imageDownloader.Dispose();
        }
    }
}
