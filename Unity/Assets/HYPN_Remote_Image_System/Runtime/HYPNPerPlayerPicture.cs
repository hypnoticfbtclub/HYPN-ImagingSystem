using UdonSharp;
using UnityEngine;
using VRC.SDKBase;

[UdonBehaviourSyncMode(BehaviourSyncMode.Manual)]
public class HYPNPerPlayerPicture : UdonSharpBehaviour
{
    [Header("HYPN IMAGING SYSTEM - URL PERSISTENTE V1.4.14")]
    [Tooltip("ID del cartel al que pertenece esta URL.")]
    public string channelId;

    [HideInInspector]
    [UdonSynced]
    public VRCUrl UrlPicture;

    [HideInInspector]
    [UdonSynced]
    public bool HasUrl;

    [HideInInspector]
    public VRCUrl PendingURL;

    [HideInInspector]
    public bool Restored;

    public override void OnPlayerRestored(VRCPlayerApi player)
    {
        VRCPlayerApi owner =
            Networking.GetOwner(gameObject);

        if (owner != null && player == owner)
        {
            // A partir de aqui ya es seguro leer/escribir User Data persistente.
            Restored = true;
        }
    }

    public void SavePendingURL()
    {
        if (!Restored ||
            !Networking.IsOwner(gameObject) ||
            VRCUrl.IsNullOrEmpty(PendingURL))
        {
            return;
        }

        string incoming = PendingURL.Get();
        string current =
            HasUrl && !VRCUrl.IsNullOrEmpty(UrlPicture)
                ? UrlPicture.Get()
                : "";

        if (HasUrl && current == incoming)
        {
            return;
        }

        UrlPicture = PendingURL;
        HasUrl = true;
        RequestSerialization();
    }

    public void ClearPersistentURL()
    {
        if (!Restored ||
            !Networking.IsOwner(gameObject))
        {
            return;
        }

        UrlPicture = VRCUrl.Empty;
        HasUrl = false;
        RequestSerialization();
    }
}
